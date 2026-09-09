"use client"

/**
 * Roles & Permissions — help article (English).
 * Covers Settings → Roles & Permissions: available roles (system + custom),
 * add/delete role, and the module-by-module permission matrix that cycles
 * Full / Edit / View / None. First help article for this page.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function RolesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are an organization administrator"
        goal="Define which roles your team is split into and control each role's access level across CRM modules"
      >
        Reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>Roles &amp; Permissions</HelpKey>. All
        roles and permissions belong only to your organization. Adding, deleting, and saving
        permissions is available to administrators with write access to Settings.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the name <HelpKey>Roles &amp; Permissions</HelpKey>, with the line "View role
          permissions and access levels across modules" beneath it, and below that the hint "Define user
          roles and their permissions for each CRM module". In the top right is the <HelpKey>Save</HelpKey>{" "}
          button — it stays disabled until you change something in the matrix. The moment you make any
          change, a <HelpKey>Cancel</HelpKey> button appears next to it.
        </p>
        <p>
          Below are two cards. The first card — <strong>Available Roles</strong> — shows every role as a
          colored badge with its user count, and an <HelpKey>Add Role</HelpKey> button in its top right.
          The second card is the permission matrix: module rows down the left, role columns across the
          top, and a changeable access-level button at each intersection. A note at the top of the matrix
          reads "Click on an access level to change it".
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Role">A named set of permissions (e.g. Admin, Manager, Agent). Each user is assigned one role.</HelpDef>
          <HelpDef term="System role">A built-in role (Admin, Manager, Agent, Viewer) — it carries a lock icon and cannot be deleted.</HelpDef>
          <HelpDef term="Custom role">A role you added — it carries a trash icon and can be deleted.</HelpDef>
          <HelpDef term="Module">A section of the CRM (Companies, Deals, Tickets, Reports, etc.) — each is one row in the matrix.</HelpDef>
          <HelpDef term="Access level">A role's permission for one module: Full, Edit, View, or None.</HelpDef>
          <HelpDef term="user count">How many users currently hold that role — shown next to the role badge.</HelpDef>
        </dl>
        <p>
          Access levels take four values: <strong>Full</strong> (green, ✓), <strong>Edit</strong> (blue,
          pencil), <strong>View</strong> (amber, eye), and <strong>None</strong> (gray, ×). Each click on
          a level button advances to the next value in that order, looping from <strong>None</strong> back
          to <strong>Full</strong>.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: change permissions and save">
        <HelpStep n={1}>
          <p>
            In the permission matrix, find the access-level button where the role column you want to
            change meets the module row (e.g. <strong>Agent</strong> × <strong>Deals</strong>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Hovering the button changes the cursor and shows the hint "Click on an access level to change
            it". The button displays the current level's icon and label (Full / Edit / View / None).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the button. Each click advances the level: <strong>Full → Edit → View → None →
            Full</strong>. Keep clicking until it lands on the level you want.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button's color and icon change immediately (e.g. from green ✓ to a blue pencil). The
            top-right <HelpKey>Save</HelpKey> button becomes active and a <HelpKey>Cancel</HelpKey> button
            appears next to it — signaling you have unsaved changes.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Once all your changes are made, click the <HelpKey>Save</HelpKey> button in the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button first reads "Saving...", then briefly "Saved" ✓, then disables again. If saving
            fails, a red error bar appears at the top of the page.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If you change your mind before saving, click <HelpKey>Cancel</HelpKey> — this reverts the
            matrix to the last saved state.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Every changed button returns to its previous value, the <HelpKey>Cancel</HelpKey> button
            disappears, and <HelpKey>Save</HelpKey> goes disabled again.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            The <strong>Admin</strong> role's access to the <strong>Settings</strong> module is always{" "}
            <strong>Full</strong> and cannot be changed. Hovering that cell shows a lock icon and the
            hint "Admin always has full access to Settings" — clicking does nothing. This prevents you
            from accidentally locking yourself out of the system.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: add a new role">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Add Role</HelpKey> button in the top right of the{" "}
            <strong>Available Roles</strong> card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Add Role" dialog opens. It has a <strong>Role Name</strong> field (placeholder "e.g. HR,
            DevOps, Support...") and a <strong>Color</strong> section with selectable colored badges (Red,
            Blue, Purple, Gray, Green, Pink, Amber, Cyan, Indigo, Teal, Orange, Slate).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Role Name</strong> and, if you wish, click a <strong>color</strong> badge to
            choose one (Slate is selected by default).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A ring appears around the color badge you select. While the name is empty or too short, the{" "}
            <HelpKey>Add Role</HelpKey> button at the bottom stays disabled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click the <HelpKey>Add Role</HelpKey> button at the bottom of the dialog. (Click{" "}
            <HelpKey>Cancel</HelpKey> if you change your mind.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog closes and the new role appears both in the <strong>Available Roles</strong> card
            (with "0 users" and a trash icon next to it) and as a new column in the matrix. The new role
            starts with <strong>View</strong> on every module — except Settings, which starts at{" "}
            <strong>None</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Adding a role is saved immediately — you don't need to press <HelpKey>Save</HelpKey>{" "}
            separately for that. To fine-tune the new role's permissions, edit its column in the matrix
            and confirm with <HelpKey>Save</HelpKey>.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: delete a role">
        <HelpStep n={1}>
          <p>
            In the <strong>Available Roles</strong> card, click the trash icon next to the custom role you
            want to remove. (System roles show a lock icon instead of a trash icon — they can't be
            deleted.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Role" confirmation dialog opens, reading "This action cannot be undone. &lt;role
            name&gt; will be permanently deleted."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Delete</HelpKey> to confirm (or <HelpKey>Cancel</HelpKey> to back out).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button reads "Deleting...", then the dialog closes and the role disappears from both the
            card and the matrix columns.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            If any users still hold that role, the delete is rejected — the confirmation dialog shows a red
            error about "N users still have this role". Move those users to another role first via{" "}
            <HelpKey>Settings</HelpKey> → <HelpKey>Users</HelpKey>, then delete the role.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The permission matrix is grouped by module area (CRM, Sales, Marketing, Communication, Support,
          Finance, and so on) — the left column lists every module row and the top row lists every role.
          To see at a glance how much access a role grants per module, follow that role's column top to
          bottom.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All roles and permissions are scoped to your organization — you only see and change your own
          tenant's roles. Adding, deleting, and saving permissions is done by administrators with write
          access to Settings; without that access the changes are rejected on the server.
        </p>
      </HelpCallout>
    </div>
  )
}
