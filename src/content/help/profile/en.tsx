"use client"

/**
 * My Profile (/profile) — help article (English).
 * Self-service "personal cabinet": open to ALL roles (not under /settings).
 * Six cards: Personal Information (avatar + name/phone/department/email + role),
 * Change Password, Security (2FA status + log out of all devices),
 * Language & Region, Appearance (theme + wallpaper), Activity (last login +
 * notification settings). Only real UI is described — nothing invented.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProfileHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a LeadDrive user — sales, support, viewer or admin, it doesn't matter"
        goal="Manage your own account: name and contact details, password, language and time zone, theme and background, sign-in history"
      >
        This is your <strong>personal cabinet</strong>; the heading reads <HelpKey>My Profile</HelpKey>{" "}
        with the subtitle "Manage your account, security and preferences". Unlike{" "}
        <HelpKey>Settings</HelpKey> (which is admin-only), this page is open to ALL roles — every change
        you make here applies to <strong>your own account only</strong>, not to other users.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The page is a single column of six cards, top to bottom: <strong>Personal Information</strong>,{" "}
          <strong>Change Password</strong>, <strong>Security</strong>, <strong>Language &amp; Region</strong>,{" "}
          <strong>Appearance</strong> and <strong>Activity</strong>. While it loads, grey skeleton bars
          appear in place of the cards.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Personal Information">Avatar (profile photo), Name, Phone, Department, Email fields, plus a read-only role badge.</HelpDef>
          <HelpDef term="Role">Your role in the system (e.g. admin, sales). Read-only — you can't change it yourself.</HelpDef>
          <HelpDef term="Change Password">Update the password you sign in with: current, new and confirm fields.</HelpDef>
          <HelpDef term="Security">Current state of two-factor authentication (authenticator + SMS) and a button to log out of all devices.</HelpDef>
          <HelpDef term="Language & Region">Display language (Russian / Azerbaijani / English) and time-zone selection.</HelpDef>
          <HelpDef term="Appearance">Theme toggle (Light / Dark) and a wallpaper selector.</HelpDef>
          <HelpDef term="Activity">Last login date, total login count and a link to notification settings.</HelpDef>
        </dl>
        <p>
          All cards sit in one centered column. The result of every change shows as a small toast in the
          bottom-right corner — for example "Saved" or an error message.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: edit personal info and upload an avatar">
        <HelpStep n={1}>
          <p>
            In the <strong>Personal Information</strong> card, edit the <strong>Name</strong>,{" "}
            <strong>Phone</strong>, <strong>Department</strong> and <strong>Email</strong> fields as
            needed.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each field has its own placeholder: "Your full name" for name, "+994 50 000 00 00" for phone,
            "e.g. Sales" for department, "you@example.com" for email. Below them sits a role badge (e.g.{" "}
            <strong>admin</strong>), which you cannot edit.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For a profile picture, click <HelpKey>Upload photo</HelpKey> next to the avatar and pick an
            image from your computer.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The hint under the button reads "PNG, JPG, WEBP or GIF, up to 2 MB". During upload the button
            shows "Uploading…" with a spinner; on success the new picture appears immediately in the round
            avatar and a "Photo updated" toast pops up. If you have no picture yet, the avatar shows the
            first letter of your name or email instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            After changing fields, click <HelpKey>Save</HelpKey> in the bottom-right of the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving…" with a spinner, then a "Saved" toast appears. Even if you
            changed nothing, it still shows "Saved". If you set the email to an address another user
            already has, you'll get "This email is already used by another user".
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: change your password">
        <HelpStep n={1}>
          <p>
            In the <strong>Change Password</strong> card, fill in <strong>Current password</strong>,{" "}
            <strong>New password</strong> and <strong>Confirm new password</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            All three fields are masked with dots. The <HelpKey>Update password</HelpKey> button below
            stays disabled (greyed out) until all three fields are filled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Update password</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The new password must contain at least 12 characters, including uppercase, lowercase, a
            number and a special character. If it does not meet the policy, the server explains the
            missing requirement; if confirmation does not match, the server shows the corresponding mismatch
            message. A wrong current password shows the current-password error. On success the password-changed
            toast appears and, after a brief pause, you are <strong>signed
            out</strong> automatically and sent to the login page.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Changing your password invalidates your current session, so the app signs you out
            automatically — this is expected. Sign back in with the new password.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: review security and log out everywhere">
        <HelpStep n={1}>
          <p>
            In the <strong>Security</strong> card, check the two-factor status:{" "}
            <strong>Authenticator app (2FA)</strong> and <strong>SMS authentication</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row carries a green <strong>Enabled</strong> or grey <strong>Disabled</strong> badge.
            These only SHOW the state — you can't toggle them on this page.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To set up or change 2FA, click the <HelpKey>Manage security settings</HelpKey> link.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            It takes you to the separate <HelpKey>Settings → Security</HelpKey> page, where the actual
            two-factor setup happens.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To sign out everywhere, click the red <HelpKey>Log out of all devices</HelpKey> button at the
            bottom of the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog appears: "Log out of all devices? You will be signed out everywhere,
            including here." After you confirm, every active session (including the current one) is ended
            and you're redirected to the login page.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Log out of all devices</strong> ends every active session, this device included —
            phone, other browsers, everywhere. Use it if you suspect your account was compromised; you'll
            have to sign in again on each device afterwards.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: change language and time zone">
        <HelpStep n={1}>
          <p>
            In the <strong>Language &amp; Region</strong> card, pick one from the <strong>Language</strong>{" "}
            dropdown: <HelpKey>Russian</HelpKey>, <HelpKey>Azerbaijani</HelpKey> or <HelpKey>English</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The choice is saved, a "Language updated" toast appears and the page reloads immediately to
            show the whole interface in the new language. This preference is stored on your account — it
            applies on other devices on their next load too.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            From the adjacent <strong>Time zone</strong> dropdown, pick your zone (e.g.{" "}
            <HelpKey>Asia/Baku</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list is a short, regional set: Europe/Warsaw, Asia/Baku, Europe/Moscow, Europe/London,
            Europe/Istanbul, Europe/Kyiv, Asia/Dubai, America/New_York and UTC. On selection a "Time zone
            updated" toast appears; the dropdown is briefly disabled while the change applies.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: change theme and wallpaper">
        <HelpStep n={1}>
          <p>
            In the <strong>Appearance</strong> card, click <HelpKey>Light</HelpKey> or{" "}
            <HelpKey>Dark</HelpKey> on the <strong>Theme</strong> toggle.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The toggle is a two-button pill; the active one is highlighted and carries the matching icon —
            a sun (Light) or a moon (Dark). The moment you click, the whole interface's color scheme
            switches.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To change the background, click the selector on the <strong>Wallpaper</strong> row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A popover opens with the available wallpaper options; picking one applies the background
            immediately.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="The Activity card">
        <p>
          The bottom <strong>Activity</strong> card shows, in two boxes, your <strong>Last login</strong>{" "}
          date ("Never" if there's none yet) and your <strong>Total logins</strong> count. Below them sits
          a <HelpKey>Notification settings</HelpKey> link that takes you to the notification settings page.
          This card is read-only; there's nothing to edit here.
        </p>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If you clear the phone or department field and save it empty, that detail is removed from your
          account — you can refill it any time later. Changing the language reloads the page, so save your
          personal info first, then change the language.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          This page manages <strong>your own account only</strong> — it doesn't affect other users. The
          role field is read-only; an administrator sets it from <HelpKey>Settings</HelpKey>. The actual
          2FA setup and password policy are managed on the separate security page.
        </p>
      </HelpCallout>
    </div>
  )
}
