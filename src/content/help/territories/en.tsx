"use client"

/**
 * Sales Territories — help article (English).
 * Split out of the shared "quotas-territories" article: covers ONLY the
 * Settings → Sales Territories page (create territories, auto-assignment
 * rules, member management, active/inactive state). Quotas are NOT here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TerritoriesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales manager or operations admin"
        goal="Split the team into geographic or industry-based regions and define which rep covers which accounts"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Sales Territories</HelpKey>. Every
        territory and member assignment belongs to your organization only. Everything you see here —
        counts, territories, and members — reads from the same list, so the stat cards update the moment
        you make a change.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Sales Territories</HelpKey> title with the line «Assign reps to
          geographic or industry-based regions» beneath it, and a <HelpKey>New Territory</HelpKey> button
          in the top-right. Below it are three stat cards: <strong>Total</strong>, <strong>Active</strong>,
          and <strong>Total Members</strong>. Under those comes the territory list — or, if you have none
          yet, an empty state instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total">The count of all territories you've created (active and inactive combined).</HelpDef>
          <HelpDef term="Active">The count of territories currently in the active state.</HelpDef>
          <HelpDef term="Total Members">The sum of member assignments across every territory.</HelpDef>
          <HelpDef term="Territory">A named region with a description, an active/inactive state, auto-assignment rules, and members.</HelpDef>
          <HelpDef term="Auto-assignment rules">Country, industry, and company-size filters that describe which companies match this territory; leave them empty and it matches all companies.</HelpDef>
          <HelpDef term="Member">A user (rep) assigned to the territory.</HelpDef>
        </dl>
        <p>
          Each territory card shows the name with an <strong>Active</strong> / <strong>Inactive</strong>{" "}
          badge beside it, a description (if any), a one-line summary of its rules, and four action
          buttons on the right: members (people icon, with a count), edit (pencil icon), pause/resume,
          and delete (trash icon). If the territory has members, the first six member names appear as
          small chips along the bottom of the card.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a territory">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New Territory</HelpKey> button in the top-right. (If you have no
            territories yet, the matching button in the middle of the empty state works too.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «New Territory» dialog opens. Inside are a <strong>Name *</strong> field and a{" "}
            <strong>Description</strong> field, an <strong>Active</strong> checkbox (ticked by default),
            and a framed «Auto-assignment Rules» box.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Name</strong> — this is the only required field (e.g. «Baku Region»). Add a
            one-line <strong>Description</strong> too if you like.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Your text appears in the fields as you type. If you try to save with the name blank, a red
            «Name is required» warning appears at the top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally fill in the «Auto-assignment Rules» box: <strong>Countries</strong> (ISO codes,
            comma-separated — e.g. <HelpKey>AZ, GE, TR</HelpKey>), <strong>Industries</strong>{" "}
            (comma-separated — e.g. Tech, Finance, Retail), <strong>Min employees</strong>, and{" "}
            <strong>Max employees</strong> (0 = unlimited).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The box opens with the hint «Leave empty = match all companies». Country codes are converted
            to uppercase automatically when saved; the employee-count fields accept numbers only.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click <HelpKey>Save Territory</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey> or the × in the top-right.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Saving…» while it saves, then the dialog closes and the new territory
            appears in the list. The <strong>Total</strong> card (and the <strong>Active</strong> card if
            it's active) ticks up by one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add or remove members">
        <HelpStep n={1}>
          <p>
            On a territory card, click the people-icon button with the count beside it
            (<HelpKey>Manage members</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Members — &lt;territory name&gt;» dialog opens. Current members are listed with their name
            and email; if there are none yet, you see «No members yet.».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To add a member, pick a user from the dropdown at the bottom and click{" "}
            <HelpKey>Add</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists only users who are NOT already members, with name and email. After adding,
            the user moves up into the current-members list and drops out of the dropdown. If the add
            fails, a red error message is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To remove a member, click the × icon on their row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The user disappears from the current-members list immediately and becomes available again in
            the dropdown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            When you're finished, close the dialog with <HelpKey>Done</HelpKey> at the bottom (or the ×).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog closes. The territory card's member count and the name chips along the bottom
            reflect the updated member list; the <strong>Total Members</strong> card adjusts as well.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit, pause, or delete a territory">
        <HelpStep n={1}>
          <p>
            To change a territory, click the pencil-icon button (<HelpKey>Edit</HelpKey>) on its card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens, titled «Edit Territory» and pre-filled with the existing name,
            description, state, and rules. Make your changes and confirm with{" "}
            <HelpKey>Save Territory</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To switch a territory off without deleting it, click <HelpKey>Pause</HelpKey> (on an inactive
            territory this button reads <HelpKey>Resume</HelpKey> instead).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card's status badge flips between green <strong>Active</strong> and grey{" "}
            <strong>Inactive</strong>, and the <strong>Active</strong> stat card's count changes
            accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To remove a territory entirely, click the red trash-icon button (<HelpKey>Delete</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Delete Territory» confirmation dialog opens, warning that deleting will also remove all
            member assignments. After you confirm, the territory drops off the list and the stat cards
            update.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion is not reversible and <strong>also removes all of that territory's member
            assignments</strong>. If you only want to take a team off rotation temporarily, use{" "}
            <HelpKey>Pause</HelpKey> to make it inactive instead — the territory and its members stay,
            they just aren't counted as active.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Filling in the rules is optional. A territory with no rules is labelled «Matches all
          companies» — you can use it purely as a named region to group people. Add the country,
          industry, and size filters only when you want to pin down which accounts qualify for this
          territory.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Every territory and member assignment is scoped to your organization — you can only add your
          own tenant's users as members, and you never see another organization's territories. The member
          dropdown is drawn from your organization's users.
        </p>
      </HelpCallout>
    </div>
  )
}
