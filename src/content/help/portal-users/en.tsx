"use client"

/**
 * Portal Users — help article (English).
 * Covers Settings → Portal Users only: managing client portal access
 * (enable/disable, password reset, clear Da Vinci chat history, remove
 * from portal, bulk actions, filters, search, statuses). First article.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function PortalUsersHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are an administrator or customer-service lead"
        goal="Control which contacts can sign in to the client portal — enable or disable access, reset passwords, and remove access when needed"
      >
        Reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>Portal Users</HelpKey>. Every name
        here is one of your organization's contacts that has an email address — you are not creating
        new users, you are granting portal access to existing contacts. As you change a filter, the
        search, or a status, the stat cards at the top and the table refresh immediately.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows <HelpKey>Portal Users</HelpKey>, with «Manage client portal access and
          passwords» below it and a hint line «Manage customer portal access for contacts». Under
          that sit four stat cards: <strong>Contacts with email</strong>,{" "}
          <strong>Access enabled</strong>, <strong>Registered</strong> and{" "}
          <strong>Logins in 7 days</strong>. Below come the filter buttons, the search box, and the
          contacts table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Contacts with email">Total contacts in the organization that have an email address — only these can be given portal access.</HelpDef>
          <HelpDef term="Access enabled">How many contacts currently have portal access turned on.</HelpDef>
          <HelpDef term="Registered">How many contacts have already set a portal password.</HelpDef>
          <HelpDef term="Logins in 7 days">How many contacts signed in to the portal in the last seven days.</HelpDef>
          <HelpDef term="Portal Status">The badge on each row: <strong>Active</strong> (access on + has a password, green), <strong>Pending</strong> (access on but no password yet, yellow), or <strong>Inactive</strong> (access off).</HelpDef>
          <HelpDef term="Last Login">When the contact last signed in to the portal; «—» if they never have.</HelpDef>
        </dl>
        <p>
          The table columns are: a checkbox, <strong>Full Name</strong>, <strong>Email</strong>,{" "}
          <strong>Company</strong>, <strong>Portal Status</strong>, <strong>Last Login</strong> and{" "}
          <strong>Actions</strong>. Each row's right side has icon buttons: enable/disable access
          (shield icon), <HelpKey>Reset password</HelpKey> (key icon — only shown for contacts that
          have a password), <HelpKey>Clear Da Vinci chat history</HelpKey> (chat icon), and{" "}
          <HelpKey>Remove from portal</HelpKey> (person-minus icon — only shown for contacts that
          have a password). When no contacts match, the table is replaced by «No contacts with email
          in organization» (or «No results found» while searching).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter and find a contact">
        <HelpStep n={1}>
          <p>
            Pick one of the filter buttons: <HelpKey>All</HelpKey>, <HelpKey>Access enabled</HelpKey>,{" "}
            <HelpKey>Registered</HelpKey>, <HelpKey>Pending</HelpKey> or <HelpKey>Disabled</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected button switches to a filled color, the others stay outlined, and the table
            shows only contacts in that category.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To find a specific person, type a name, email, or company into the{" "}
            <HelpKey>Search...</HelpKey> box on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table filters as you type. If nothing matches, the table is replaced by «No results
            found».
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: enable or disable access for one contact">
        <HelpStep n={1}>
          <p>
            Click the shield icon on the right of the contact's row — it reads green{" "}
            <HelpKey>Enable access</HelpKey> when access is off, and red{" "}
            <HelpKey>Disable access</HelpKey> when access is on.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The moment you click, the row's <strong>Portal Status</strong> badge changes:{" "}
            <strong>Inactive</strong> when you turn it off, and <strong>Active</strong> or{" "}
            <strong>Pending</strong> (depending on whether a password exists) when you turn it on. The{" "}
            <strong>Access enabled</strong> card at the top updates to match.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: manage several contacts at once">
        <HelpStep n={1}>
          <p>
            Tick the checkbox at the left of each row you want to manage (or use the header checkbox
            to select all).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A gray bar appears above the table: «Selected: N» on the left, with{" "}
            <HelpKey>Enable access</HelpKey> and <HelpKey>Disable</HelpKey> buttons on the right.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Enable access</HelpKey> to turn access on for all selected contacts, or{" "}
            <HelpKey>Disable</HelpKey> to turn it off.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Every selected row updates at once, the selection clears, and the bar disappears. The
            stat-card counts reflect the new state.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: reset a password">
        <HelpStep n={1}>
          <p>
            Click the key icon <HelpKey>Reset password</HelpKey>, which only appears on{" "}
            <strong>Active</strong> contacts (those that already have a password).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog titled «Reset Password» opens: «This contact's portal password will
            be reset. They will need to set a new password.» — with a <HelpKey>Reset</HelpKey> button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm with <HelpKey>Reset</HelpKey> (or close the dialog if you change your mind).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Resetting...», then the dialog closes. The contact's password is
            cleared, so their status becomes <strong>Pending</strong> — they must set a new password
            on their next sign-in.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: clear Da Vinci chat history">
        <HelpStep n={1}>
          <p>
            Click the chat icon <HelpKey>Clear Da Vinci chat history</HelpKey> on the contact's row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled «Clear Da Vinci Chat History» opens, warning that all of this contact's
            Da Vinci chat history will be deleted and the action cannot be undone. The confirm button
            reads <HelpKey>Clear</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm with <HelpKey>Clear</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Clearing...», then the dialog closes. The contact's portal access
            and status are unchanged — only their past Da Vinci chats are removed.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: remove a contact from the portal">
        <HelpStep n={1}>
          <p>
            Click the person-minus icon{" "}
            <HelpKey>Remove from portal (will need to re-register)</HelpKey>, which only appears on
            contacts that have a password.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog titled «Remove from Portal» opens: «This contact's portal access
            will be revoked and password deleted. They will need to re-register.» — with a{" "}
            <HelpKey>Remove</HelpKey> button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm with <HelpKey>Remove</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog closes. The contact's access is turned off and their password is deleted, so
            the status becomes <strong>Inactive</strong> and the key / person-minus buttons disappear
            from the row. The stat cards update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The status badges are for a quick read: <strong>Pending</strong> (yellow) means you have
          enabled access but the contact hasn't set a portal password yet; <strong>Active</strong>{" "}
          (green) means the contact has registered and can sign in. For a customer who forgot their
          password, <HelpKey>Reset password</HelpKey> is gentler than{" "}
          <HelpKey>Remove from portal</HelpKey> — access stays on and they are simply asked to set a
          new password.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Clear Da Vinci chat history</HelpKey> and <HelpKey>Remove from portal</HelpKey>{" "}
          cannot be undone. Removal deletes the password and forces the contact to re-register from
          scratch — if you only want to block them temporarily, use the shield button to{" "}
          <HelpKey>Disable access</HelpKey> instead (the password is kept).
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          You only see and manage contacts with an email address in your own organization — you have
          no access to another tenant's portal users. The access, password, and chat-history actions
          affect the client portal only; they don't touch the contact's CRM record or your own CRM
          login account.
        </p>
      </HelpCallout>
    </div>
  )
}
