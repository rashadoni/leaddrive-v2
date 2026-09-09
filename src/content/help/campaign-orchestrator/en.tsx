"use client"

/**
 * Customer Journeys (campaign orchestrator) — help article (English).
 * Rewritten in the video-script format. Covers only the Customer Journeys
 * (/journeys) page: creating a journey (templates + form), the steps editor
 * (linear + visual builder), enrolling leads, managing enrollments, and
 * pause/resume/delete. Features NOT present on the page (e.g. A/B splits)
 * are NOT included.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CampaignorchestratorHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You run marketing or sales operations"
        goal="Build an event-triggered, multi-step automation — chain emails, SMS, waits, conditions and tasks together, then enroll leads and track the outcome"
      >
        Open the page from <HelpKey>Customer Journeys</HelpKey> in the left menu. All journeys,
        enrollments and leads belong to your organization only. The stat cards at the top read from
        the list, so the counters update immediately as you activate a journey or enroll a lead.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a flow icon next to <HelpKey>Customer Journeys</HelpKey>, with the subtitle
          "Automation sequences for customer engagement" beneath it and a <HelpKey>New Journey</HelpKey>{" "}
          button at the top right. Below come a one-line description and a "Did you know?" tip strip.
          Then four stat cards line up: <strong>Total</strong>, <strong>Active</strong>,{" "}
          <strong>Entries</strong> and <strong>Completed</strong> (as a percentage). If enrollments
          have exit reasons, an "Exit reasons" row of badges appears below the cards. Further down is
          the list of journey cards — if there are no journeys yet, an empty state is shown instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Journey">An automation sequence that starts on an event and runs step by step — with a name, status, trigger and steps.</HelpDef>
          <HelpDef term="Total">The number of all journeys you've created (every status combined).</HelpDef>
          <HelpDef term="Active">The number of journeys currently in the "Active" status.</HelpDef>
          <HelpDef term="Entries">The total number of contacts (enrollments) that entered all journeys.</HelpDef>
          <HelpDef term="Completed">The percentage of enrollments that finished the full path (conversion rate).</HelpDef>
          <HelpDef term="Trigger">The event that starts a journey: Manual, New Lead, New Contact, or Deal Stage Changed.</HelpDef>
          <HelpDef term="Step">One stage of a journey: Email, SMS, Wait, Condition, Task, Telegram, WhatsApp or Update Field.</HelpDef>
          <HelpDef term="Goal">An optional success metric (e.g. Deal Created) — it sets how many conversions you expect and whether to exit when the goal is reached.</HelpDef>
          <HelpDef term="Enrollment (participant)">A specific lead or contact placed into a journey — it can be active, paused or completed.</HelpDef>
        </dl>
        <p>
          Each journey card shows a status badge on the left (<strong>Draft</strong> /{" "}
          <strong>Active</strong> / <strong>Paused</strong> / <strong>Completed</strong>) and the
          journey name, an optional description, and below them the trigger, <strong>Entered</strong>,{" "}
          <strong>Active</strong> and <strong>Completed</strong> counts. If a goal is set, a small
          progress bar shows "Goal: current/target". On the right are five action buttons:{" "}
          <HelpKey>Steps</HelpKey> (eye icon), <HelpKey>Edit</HelpKey> (pencil),{" "}
          <HelpKey>Enroll Lead</HelpKey> (person+plus), pause/resume (<HelpKey>Pause</HelpKey> when
          active, <HelpKey>Active</HelpKey> when paused) and delete (trash icon).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new journey">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New Journey</HelpKey> at the top right. (If there are no journeys yet, the
            same-named button in the middle of the empty state works too.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Choose a Template" dialog opens. It holds four template cards:{" "}
            <strong>Welcome Flow</strong>, <strong>Lead Nurturing</strong>,{" "}
            <strong>Deal Follow-up</strong> and <strong>Blank Journey</strong> — each with a short
            description.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click a template card. If you want to start from scratch with full control, choose{" "}
            <HelpKey>Blank Journey</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog switches to the form view. At the top is a "← Back to templates" link, then the
            fields: <strong>Name *</strong>, side-by-side <strong>Status</strong> and{" "}
            <strong>Trigger</strong> dropdowns, an <strong>Audience Segment</strong> picker,{" "}
            <strong>Description</strong>, <strong>Max Enrollment Days</strong>, and a collapsible "Goal
            Tracking" section. The values of the template you chose are pre-filled into the fields.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Type a <strong>Name</strong> — this is the only required field (e.g. "Welcome for new
            leads"). If needed, choose a <strong>Status</strong> (Draft by default) and a{" "}
            <strong>Trigger</strong> (Manual, New Lead, New Contact, Deal Stage Changed).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text appears in the field as you type. If you try to save with an empty name, a red
            "Required field" warning appears at the top of the form and the dialog does not close.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally pick an <strong>Audience Segment</strong> (defaults to "All contacts (no
            filter)"), add a one-line <strong>Description</strong>, and set{" "}
            <strong>Max Enrollment Days</strong> (auto-exit after N days, 1–365).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The segment dropdown lists "All contacts" alongside your organization's segments (with a
            contact count next to each). Below it sits the hint "Only contacts matching this segment
            will enter the journey". The enrollment-days field accepts numbers only.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            To measure success, click the <HelpKey>Goal Tracking</HelpKey> header to expand it and pick
            a <strong>Goal Type</strong> (No goal, Deal Created, Status Change, Ticket Resolved). If
            needed, enter a <strong>Goal Target (conversions)</strong> and tick the{" "}
            <strong>Exit on goal reached</strong> checkbox.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The triangle next to the header shows expanded/collapsed state. Choosing "Status Change"
            reveals an extra <strong>Target Status Value</strong> field (e.g. converted, qualified).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Use{" "}
            <HelpKey>Cancel</HelpKey> or the × at the top right.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving…", then the dialog closes and the new journey appears in the
            list. The <strong>Total</strong> card count goes up by one (and the <strong>Active</strong>{" "}
            card too if you set the status to Active).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            A freshly created journey has NO steps yet. For it to do anything, you must add at least one
            step (as in the next section) and set its status to <strong>Active</strong> — otherwise
            nothing happens to the contacts that enter.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: add steps to a journey">
        <HelpStep n={1}>
          <p>
            On a journey card, click <HelpKey>Steps</HelpKey> (the eye icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog opens with the journey name; below the title it shows the status, trigger and (if
            set) goal. At the top is a <HelpKey>Visual Builder</HelpKey> / <HelpKey>List View</HelpKey>{" "}
            toggle and an <HelpKey>Enroll Lead</HelpKey> button. Below is a vertical flow starting from a
            purple <strong>Trigger</strong> node, the existing steps, and a dashed "+ Add step" button
            at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Add step</HelpKey> (the dashed +) at the bottom of the flow.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Add step #N" dialog opens. At the top is a grid of eight step types:{" "}
            <strong>Email</strong>, <strong>SMS</strong>, <strong>Wait</strong>,{" "}
            <strong>Condition</strong>, <strong>Task</strong>, <strong>Telegram</strong>,{" "}
            <strong>WhatsApp</strong> and <strong>Update Field</strong>. <strong>Email</strong> is
            selected by default.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick a type and fill in the fields that appear below. For example, <strong>Email</strong>{" "}
            takes a subject and body, <strong>Wait</strong> takes a number and unit (Hours/Days/Weeks),{" "}
            <strong>Condition</strong> takes one of the ready-made scenario cards (e.g. "When lead is
            qualified") or "Custom condition", and <strong>Task</strong> takes a name and description.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The type you pick is highlighted and only its fields are shown. Choosing{" "}
            <strong>Condition</strong> reveals nine scenario cards and, below in a red box, an "If
            condition is not met" choice (Continue to next step, Skip 1/2 steps, Restart, Stop chain).
            Picking "Custom condition" opens extra Field/Operator/Value fields. In the email subject and
            body you can use variables like <HelpKey>{"{{contact_name}}"}</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click <HelpKey>Add</HelpKey> at the bottom of the dialog. (Use <HelpKey>Cancel</HelpKey> to
            back out if needed.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog closes and the new step is added to the flow as a numbered node (e.g. "1. Email"),
            with a short summary and "Entered / Passed" stats underneath. You can add as many steps as
            you like; each step has a pencil (edit) and trash (delete) icon above it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            When everything is ready, click <HelpKey>Save steps</HelpKey> at the bottom of the dialog.
            (To leave without changes, use <HelpKey>Close</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving…", then the dialog closes. The steps are saved and the counts
            on the journey card update accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            The <HelpKey>Visual Builder</HelpKey> button at the top of the steps dialog shows the same
            journey as a drag-and-drop diagram. <HelpKey>List View</HelpKey> takes you back. Both views
            work on the same steps — they're just two ways to edit.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: enroll a lead and manage enrollments">
        <HelpStep n={1}>
          <p>
            On a journey card, click <HelpKey>Enroll Lead</HelpKey> (the person+plus icon). (The
            same-named button inside the Steps dialog works too.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Enroll Lead" dialog opens; the journey you're enrolling into is shown in bold at the top.
            Below is a search field and the list of leads; while leads load a "Loading leads…" spinner
            appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a lead's name, email or company into the search field and pick one from the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows the lead's initial avatar, name, email/company and a status badge (New,
            Qualified, Contacted, etc.). A "M of N leads" counter sits below. When you pick one, a green
            confirmation strip appears at the top; you can clear the selection with ×. If nothing
            matches, "Nothing found" is shown; if there are no leads at all, "No leads available".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Enroll</HelpKey> at the bottom. (The button is disabled until a lead is
            selected.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button turns into a spinner, then the dialog closes and the list refreshes. The lead
            becomes an enrollment of the journey — the card's <strong>Entered</strong> count and the{" "}
            <strong>Entries</strong> stat card go up accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To see existing enrollments, open the <HelpKey>Steps</HelpKey> dialog and scroll down in the{" "}
            <HelpKey>List View</HelpKey> — there's an enrollments table there.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Under an "Enrollments (N)" heading, each row is one participant: a status badge (Active /
            Paused / Completed), a short lead/contact ID and (if any) an exit reason. On the right,
            status-aware action buttons appear: <HelpKey>Pause</HelpKey> when active,{" "}
            <HelpKey>Resume</HelpKey> when paused, and <HelpKey>Cancel</HelpKey> for either.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit, pause/resume or delete a journey">
        <HelpStep n={1}>
          <p>
            To change a journey, click <HelpKey>Edit</HelpKey> (the pencil icon) on the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens titled "Edit Journey", pre-filled with the existing name, status,
            trigger, segment, description, enrollment days and goal values. Make your changes and confirm
            with <HelpKey>Save</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To switch a journey on/off without deleting it, click the status button: on an active
            journey it reads <HelpKey>Pause</HelpKey>, on a paused one it reads <HelpKey>Active</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge on the card flips between <strong>Active</strong> and{" "}
            <strong>Paused</strong>, and the <strong>Active</strong> stat card count changes
            accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete a journey entirely, click the red trash icon button on the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Journey" confirmation dialog opens and shows the journey name. After you confirm,
            the journey leaves the list and the stat cards update.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion cannot be undone. If you only want to put a journey on hold, pause it with{" "}
            <HelpKey>Pause</HelpKey> instead of deleting — the journey, its steps and its enrollments
            stay, only no one new is processed.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Starting from a template is the fastest path: <strong>Welcome Flow</strong>,{" "}
          <strong>Lead Nurturing</strong> and <strong>Deal Follow-up</strong> pre-fill the trigger,
          enrollment window and goal — all that's left is to name it and add steps. Choose{" "}
          <strong>Blank Journey</strong> when you want full control from scratch.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All journeys, enrollments and the leads you can enroll are scoped to your organization — you
          don't see another tenant's journeys and can only enroll your own leads. The lead search list
          and segments come from your organization's data.
        </p>
      </HelpCallout>
    </div>
  )
}
