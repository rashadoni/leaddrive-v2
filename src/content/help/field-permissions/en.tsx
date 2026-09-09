"use client"

/**
 * Field Permissions — help article (English).
 * Split out of the shared "users-permissions" article: covers ONLY the
 * Settings → Field Permissions page (the role × field permission matrix
 * with Edit/View/Hidden, plus sharing rules). User/role management is NOT
 * covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function FieldPermissionsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an administrator or the person responsible for security"
        goal="Decide which role can see or edit each field, and set up rules for sharing records across roles"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Field Permissions</HelpKey>.
        All permissions and sharing rules apply only to your organization. The{" "}
        <strong>Admin</strong> role always has full access and can't be changed — you configure the
        remaining roles (Manager, Sales, Support, Viewer).
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Field Permissions</HelpKey> with the description
          "Control visibility and editability of fields per role. Admin always has full access."
          Below it are two cards: first the <strong>Field Permission Matrix</strong>, then{" "}
          <strong>Sharing Rules</strong>.
        </p>
        <p>
          The matrix card has a shield icon next to the "Field Permission Matrix" title, and on the
          right an entity-type dropdown (Companies, Contacts, Deals, Leads, Tickets). The table's
          left column lists <strong>Field</strong> names; the remaining columns are the five roles:{" "}
          <strong>Admin</strong>, <strong>Manager</strong>, <strong>Sales</strong>,{" "}
          <strong>Support</strong>, <strong>Viewer</strong>. Each cell holds a colored button showing
          that role's access to that field.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Entity Type">The record type whose permissions you're configuring — chosen from the dropdown (Companies, Contacts, Deals, Leads, Tickets). Each type has its own set of fields.</HelpDef>
          <HelpDef term="Field">One data field of the selected entity (e.g. Phone, Email, Annual Revenue). Each table row is one field.</HelpDef>
          <HelpDef term="Edit">Green button — the role can see AND change this field.</HelpDef>
          <HelpDef term="View">Blue button — the role can only read this field, not change it.</HelpDef>
          <HelpDef term="Hidden">Red button — the role can't see this field at all.</HelpDef>
          <HelpDef term="sensitive">A small badge next to some fields, marking them as sensitive data (e.g. Phone, Email, Annual Revenue, VOEN).</HelpDef>
          <HelpDef term="Sharing Rule">A rule that opens one role's records to another role (or to all users) at a given access level. By default, users see only their own records.</HelpDef>
        </dl>
        <p>
          The Sharing Rules card has the title "Sharing Rules" and a <HelpKey>New Rule</HelpKey>{" "}
          button on the right. When no rules exist yet, the card shows "No sharing rules configured.
          By default, users see only their own records." Once rules are added, each is listed with
          its name, an entity-type → role-to-role → access-level summary, and three controls on the
          right: an active/inactive toggle, edit (shield icon), and delete (trash icon).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: change a field permission">
        <HelpStep n={1}>
          <p>
            From the dropdown at the top-right of the matrix card, pick an{" "}
            <HelpKey>entity type</HelpKey> (e.g. <HelpKey>Companies</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads with the fields of the type you chose. A spinner appears briefly while
            loading, then each row shows one field name and the five role columns.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Find the <strong>field</strong> row and the <strong>role</strong> column you want to
            change, then click the colored button in that cell. Each click cycles the access level:{" "}
            <strong>Edit</strong> → <strong>View</strong> → <strong>Hidden</strong> → back to Edit.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button's label and color change immediately (green "Edit", blue "View", red
            "Hidden"). A thin ring appears around any cell you've changed, so you can spot unsaved
            edits.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            As soon as you make at least one change, two buttons appear at the top of the card next
            to the entity selector: <HelpKey>Reset Defaults</HelpKey> and <HelpKey>Save</HelpKey>.
            Click <HelpKey>Save</HelpKey> to commit your changes.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <HelpKey>Save</HelpKey> button turns into a spinner while saving. When it finishes,
            the rings around the cells disappear — meaning your changes are now recorded.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If you want to discard your selections without saving, click{" "}
            <HelpKey>Reset Defaults</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            All unsaved changes are cleared, the cells revert to their previous state, and both
            buttons (Reset / Save) hide again.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            The <strong>Admin</strong> column always has full access and its cells are dimmed — you
            can't click them. You can only change permissions for the Manager, Sales, Support, and
            Viewer roles.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: create a sharing rule">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New Rule</HelpKey> button at the top-right of the Sharing Rules card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled "New Sharing Rule" opens. It contains <strong>Name</strong>,{" "}
            <strong>Entity Type</strong>, <strong>Rule Type</strong>, <strong>Access Level</strong>{" "}
            and <strong>Description</strong> fields, each with a short explanation underneath.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Name</strong> (e.g. "Managers see Sales deals") and pick an{" "}
            <strong>Entity Type</strong> — this sets which kind of records the rule applies to.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Text appears in the Name field as you type. While the Name is empty, the{" "}
            <HelpKey>Save</HelpKey> button at the bottom stays dimmed and won't let you save the rule.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Choose a <strong>Rule Type</strong>: <HelpKey>Owner Only</HelpKey> (everyone sees only
            their own records), <HelpKey>Role → Role</HelpKey> (one role's records open to another),
            or <HelpKey>All Users</HelpKey> (records visible to everyone).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Choosing <HelpKey>Role → Role</HelpKey> reveals two extra fields in the dialog:{" "}
            <strong>Source Role</strong> ("Whose records will be shared?") and{" "}
            <strong>Target Role</strong> ("Who gets access?"). Both dropdowns list every role except
            Admin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Pick an <strong>Access Level</strong> — <HelpKey>Read Only</HelpKey> or{" "}
            <HelpKey>Read &amp; Write</HelpKey>. Optionally add a short <strong>Description</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The explanatory text under each control updates with your selection. The Description field
            is optional and may be left blank.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Save</HelpKey> at the bottom of the dialog. (Changed your mind? Close it
            with <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog closes and the new rule appears in the Sharing Rules list — with its name,
            entity type, role-to-role (or "All users") and access-level summary.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: toggle, edit or delete a rule">
        <HelpStep n={1}>
          <p>
            To temporarily turn a rule off or back on, click the{" "}
            <HelpKey>active/inactive toggle</HelpKey> on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The toggle changes state — green and pointing right when active, gray and pointing left
            when inactive.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To change a rule, click the shield-icon (<HelpKey>Edit</HelpKey>) button on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens, titled "Edit Sharing Rule" and pre-filled with the current name,
            entity type, rule type, roles, access level and description. Make your edit and confirm
            with <HelpKey>Save</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete a rule, click the red trash-icon (<HelpKey>Delete</HelpKey>) button on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Sharing Rule" confirmation dialog opens asking "Are you sure you want to delete
            this sharing rule?" After you confirm, the rule disappears from the list.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Matrix changes are only recorded when you click <HelpKey>Save</HelpKey> — you can click
          several fields one by one and save them all at once. Made a mistake? Before saving, use{" "}
          <HelpKey>Reset Defaults</HelpKey> to revert everything. Switching the entity type also
          discards any unsaved changes.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All field permissions and sharing rules are scoped to your organization — they affect only
          your tenant's roles. The <strong>Admin</strong> role always has full access to every field
          and can't be changed in the matrix; be especially careful when granting access to{" "}
          <strong>sensitive</strong>-badged fields (Phone, Email, Annual Revenue, VOEN, etc.). With
          no sharing rules set up, the default behavior is: users see only their own records.
        </p>
      </HelpCallout>
    </div>
  )
}
