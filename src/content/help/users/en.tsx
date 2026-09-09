"use client"

/**
 * Users — help article (English).
 * Split out of the shared "users-permissions" article: covers ONLY the
 * Settings → Users page (create/edit account, role, department, phone,
 * stat cards, table columns, active/available toggles, 2FA pills, delete).
 * "Field Permissions" (the per-role field matrix) is NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function UsersHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are an administrator or team lead"
        goal="Manage who can sign in to the CRM — create accounts, assign roles and departments, activate/deactivate users, and tune 2FA and support settings"
      >
        Reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>Users</HelpKey>. Every account belongs
        to your organization only. The heading shows the current user count in parentheses, with the
        line "Manage CRM user accounts, roles and access permissions" underneath. The stat cards at the
        top update instantly as you make changes.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The heading reads <HelpKey>Users ({"{"}count{"}"})</HelpKey> (current count in parentheses),
          with an <HelpKey>Add</HelpKey> button at the top right. Below are four stat cards:{" "}
          <strong>Total</strong>, <strong>Active</strong>, <strong>Inactive</strong> and{" "}
          <strong>Admins</strong>. Under them sits the user table with a search box.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total">Count of all users in the organization.</HelpDef>
          <HelpDef term="Active">Count of users whose account is active (able to sign in).</HelpDef>
          <HelpDef term="Inactive">Count of users whose account is switched off.</HelpDef>
          <HelpDef term="Admins">Count of users whose role is "Admin".</HelpDef>
          <HelpDef term="Role">The user's permission level — system roles are Admin, Manager, Agent, Viewer; any custom roles your organization created also appear in the list.</HelpDef>
          <HelpDef term="Available">A green/grey toggle showing whether a support agent accepts new tickets — used for automatic ticket routing.</HelpDef>
          <HelpDef term="Status">The account's active/inactive state — click the badge to flip it instantly.</HelpDef>
          <HelpDef term="2FA">Two-factor status — TOTP and SMS pills (✓ = configured) plus a "Require 2FA" toggle.</HelpDef>
        </dl>
        <p>
          Table columns: <strong>User</strong> (name with email beneath), <strong>Role</strong> (colored
          badge + icon), <strong>Department</strong>, <strong>Skills</strong> ("—" if none),{" "}
          <strong>Max</strong> (max concurrent tickets), <strong>Available</strong> (toggle),{" "}
          <strong>Status</strong> (Active/Inactive badge), <strong>Last login</strong> (date-time or
          "Never"), <strong>2FA</strong> (TOTP/SMS pills + require toggle), and at the end the edit
          (pencil) and delete (trash) buttons. The <strong>"Search users…"</strong> box at the top
          filters by name; click a column header to sort.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: add a new user">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Add</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Add user" dialog opens. It contains <strong>Name *</strong>, <strong>Email *</strong>,{" "}
            <strong>Password *</strong>, <strong>Role</strong>, <strong>Department</strong>,{" "}
            <strong>Phone</strong> fields and, at the very bottom, an <strong>Active</strong> checkbox
            (ticked by default).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Enter <strong>Name</strong>, <strong>Email</strong> and <strong>Password</strong> — these
            three are required. The password must contain at least 12 characters, including uppercase,
            lowercase, a number and a special character.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The password field stays masked with dots as you type. If a required field is empty, the
            browser prompts you to fill it and the form is not saved.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick the permission level from the <strong>Role</strong> dropdown (defaults to{" "}
            <HelpKey>Viewer</HelpKey>). Optionally type a <strong>Department</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The role list shows system roles with localized labels (Admin, Manager, Agent, Viewer); if
            your organization created custom roles, they appear by their own name too.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally enter a <strong>Phone</strong> in international format, starting with{" "}
            <HelpKey>+</HelpKey> and a country code (e.g. <HelpKey>+994501234567</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A hint under the field reads "International format — start with + and country code…". Spaces,
            brackets and dashes are stripped as you type; if the format is wrong the field turns red with
            "Invalid format: must start with + followed by 7–15 digits."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving…", then the dialog closes and the new user appears in the
            table. The <strong>Total</strong> (plus <strong>Active</strong> if active, and{" "}
            <strong>Admins</strong> if the role is admin) card count rises. If the email already exists,
            a red error message shows in the form.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit a user (password, support, language)">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Edit</HelpKey> next to the user&apos;s name. The action stays visible even when
            the table is wider than the screen.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Edit user" dialog opens, pre-filled with the existing data. The password field is now
            labelled <strong>"New password (leave blank to keep)"</strong> — leave it empty and the
            current password stays unchanged.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In edit mode only, extra fields appear: <strong>Briefing language</strong> (language of the
            daily AI briefing), a <strong>Support settings</strong> section, and inside it{" "}
            <strong>Max concurrent tickets</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The briefing-language list offers <strong>Organization default</strong>, Русский, English and
            Azərbaycan, with "Language for the daily AI briefing…" beneath it. Under the "Support
            settings" heading, the ticket field accepts a number from 1–100 (defaults to 20).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Make your changes and click <HelpKey>Update</HelpKey> at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows "Saving…", then the dialog closes and the table row reflects the updated
            data.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: manage status, availability and 2FA from the table">
        <HelpStep n={1}>
          <p>
            To switch a user off or on, click the <HelpKey>Active</HelpKey> / <HelpKey>Inactive</HelpKey>{" "}
            badge directly in the <strong>Status</strong> column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The badge flips instantly between a green <strong>Active</strong> and a grey{" "}
            <strong>Inactive</strong>; the <strong>Active</strong> and <strong>Inactive</strong> stat
            cards at the top change accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Use the toggle in the <strong>Available</strong> column to set whether a support agent
            accepts new tickets.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The toggle slides between green (available) and grey (not available). It feeds automatic
            ticket routing.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            The <strong>2FA</strong> column has three elements: a <HelpKey>TOTP</HelpKey> pill, an{" "}
            <HelpKey>SMS</HelpKey> pill, and a <HelpKey>Require 2FA</HelpKey> toggle. A ✓ on a pill means
            that method is configured; click a configured pill to reset it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking a configured TOTP pill brings up the "Reset TOTP 2FA for this user?…" confirmation;
            SMS shows a similar message. Turning on the require toggle means "Require 2FA on login (any
            method)".
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Resetting a 2FA pill switches that user's two-factor off — they can{" "}
            <strong>sign in without a code</strong> until they set it up again. Only do this when a user
            has lost their device and is locked out.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: delete a user">
        <HelpStep n={1}>
          <p>
            Click the red trash (<HelpKey>Delete</HelpKey>) button on the right of the user's row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete user" confirmation dialog opens, showing the name of the user to be deleted.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm the deletion, or close the dialog to cancel.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After confirming, the user disappears from the table and the stat cards update. If deletion
            fails (e.g. trying to remove the last admin), a red error message is shown.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Instead of deleting a user outright, it is often safer to simply deactivate them via the{" "}
            <strong>Status</strong> badge — the account and its history stay, the user just can't sign
            in.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <strong>Skills</strong> column is read-only — you don't edit it from this form; skills are
          assigned elsewhere on the user's profile and feed automatic ticket routing. The search box at
          the top of the table filters by <strong>name</strong> only.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All user accounts are scoped to your organization — you can't see or manage users from another
          organization. A user's <strong>Role</strong> governs everything they can see and do across the
          CRM, so grant the Admin role only to people you trust.
        </p>
      </HelpCallout>
    </div>
  )
}
