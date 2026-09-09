"use client"

/**
 * Approval Delegation — help article (English).
 * Covers only Settings → Approval Delegation: routing your contract
 * approvals to another user while you're out of office
 * (create a delegation, date range, reason, delete).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ApprovaldelegatesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a manager or team lead who approves contracts"
        goal="Make sure contract approvals don't get stuck with you while you're on leave or traveling by routing them to a trusted colleague"
      >
        Reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>Approval Delegation</HelpKey>. These are{" "}
        <strong>your own delegations</strong> — you appoint someone to act on your behalf. For the period you
        set, the contract approval stages that would land on you are automatically routed to the colleague
        you choose. Everything here is scoped to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left has a back arrow to return to <HelpKey>Settings</HelpKey>, a person icon next to it, and the{" "}
          <HelpKey>Approval Delegation</HelpKey> title. Under the title sits the line «Out-of-office contract
          approval routing» plus a one-line page description. On the right is the <HelpKey>Add Delegation</HelpKey>{" "}
          button (with a plus icon). Below it comes the list of delegations — if there are none yet, an empty
          state shows instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Delegation">An entry that routes your contract approvals to another user for a set date range.</HelpDef>
          <HelpDef term="Delegate to">The colleague who will approve on your behalf — their name and email show on the card.</HelpDef>
          <HelpDef term="Start / End Date">The date range the delegation is in effect; it appears on the card as «start → end».</HelpDef>
          <HelpDef term="Reason">An optional note (vacation, business trip, etc.); when filled it shows as a badge on the card.</HelpDef>
          <HelpDef term="Active">Green badge — today's date falls inside the start–end range, so the delegation is in effect right now.</HelpDef>
          <HelpDef term="Upcoming">Grey badge — the delegation starts in the future (its start date hasn't arrived yet).</HelpDef>
        </dl>
        <p>
          Each delegation is shown on its own card: «<strong>Delegate to</strong>: name», the email below it,
          a calendar icon with the date range, an optional reason badge, then — depending on timing — a green{" "}
          <strong>Active</strong> or grey <strong>Upcoming</strong> badge. On the right of the card is a red
          trash icon for deleting the delegation. There is no edit button on this page: to change a delegation,
          you delete the old one and create a new one.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a delegation">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Add Delegation</HelpKey> in the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled «Add Approval Delegate» opens. Inside are a <strong>Delegate to</strong> dropdown,
            side-by-side <strong>Start Date</strong> and <strong>End Date</strong> fields, and below them a{" "}
            <strong>Reason</strong> field marked «Optional».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick the colleague who will approve on your behalf from the <HelpKey>Delegate to</HelpKey> dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A brief «Loading...» appears until the list is ready. Then it lists your organization's active users
            in «name (email)» format — <strong>you are not in the list</strong>, so you can't make yourself your
            own delegate. The default option reads «Select a colleague...».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Fill in <HelpKey>Start Date</HelpKey> and <HelpKey>End Date</HelpKey> — both are required. This is
            the period the delegation will be in effect (e.g. the start and end of your leave).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each field is a date picker — clicking it opens a calendar to choose a day from.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally type a <HelpKey>Reason</HelpKey> (e.g. «vacation» or «business trip»). You can leave
            this field empty.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field shows the hint «out_of_office, vacation, handoff...». It accepts up to 100 characters; if
            you fill it, it will later appear as a badge on the card.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Save Delegation</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner appears next to the button while saving, then the dialog closes and the new delegation
            shows up in the list. If the start date is today or earlier, the card immediately gets a green{" "}
            <strong>Active</strong> badge; if it's in the future, a grey <strong>Upcoming</strong> badge. If
            something is wrong (e.g. an empty field), red error text shows inside the dialog and it stays open.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: delete a delegation">
        <HelpStep n={1}>
          <p>
            Click the red trash icon on the right of the delegation card you want to remove.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button turns into a spinner for a moment, then the delegation disappears from the list. If it
            was the last one, the page returns to the empty state.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            There is no confirmation dialog on this page — clicking the trash button deletes the delegation
            right away. After deletion, approvals in that date range route back to you. To just change the name
            or dates, there's no edit: delete the old one and re-enter the correct details via{" "}
            <HelpKey>Add Delegation</HelpKey>.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Empty state">
        <p>
          If you haven't created any delegations yet, instead of a list you see a faded person icon centered on
          a card, the heading «<strong>No active delegations</strong>», and the line «Add a delegation to route
          your contract approvals while you're away.» To create one, use the <HelpKey>Add Delegation</HelpKey>{" "}
          button in the top right as usual.
        </p>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          A delegation only works during the <strong>date range</strong> you set — you can create one ahead of
          time: until the start date arrives the card waits as <strong>Upcoming</strong>, then becomes{" "}
          <strong>Active</strong> on its own when the date hits. After the period ends the card may still be in
          the list, but it no longer routes approvals.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The delegate dropdown is sourced only from your <strong>organization's active users</strong> — you
          can't pick a user from another organization, and you don't see yourself in the list. The delegations
          you manage here belong to your own account.
        </p>
      </HelpCallout>
    </div>
  )
}
