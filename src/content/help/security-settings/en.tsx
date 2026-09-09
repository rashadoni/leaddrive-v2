"use client"

/**
 * Security settings — help article (English).
 * Covers Settings → Security: Authenticator (TOTP) 2FA, SMS 2FA,
 * Authentication Methods (Google/Microsoft OAuth toggles), Linked
 * Accounts (link/unlink) and API Keys. Only the real UI on this page.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SecuritySettingsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a user or administrator protecting your account and your organization's sign-in"
        goal="Set up two-factor authentication (authenticator or SMS), manage login methods, link social accounts, and create API keys for integrations"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Security</HelpKey>. At the top you'll see
        a back arrow, a shield icon, the <HelpKey>Security</HelpKey> title, and the line "Two-factor
        authentication, password policies and security settings". 2FA and linked accounts belong to YOUR
        account; authentication methods and API keys act at the organization level.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          From top to bottom the page has several sections: an <strong>Authenticator 2FA</strong> card,{" "}
          <strong>SMS Two-Factor Authentication</strong>, <strong>Authentication Methods</strong>,{" "}
          <strong>Linked Accounts</strong>, and <strong>API Keys</strong>. Each section has its own heading,
          icon, and short description.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="2FA (two-factor authentication)">A second confirmation step on top of your password — a one-time code from an authenticator app or from SMS.</HelpDef>
          <HelpDef term="Authenticator app">Apps like Google Authenticator, Authy, or Microsoft Authenticator that scan a QR code and generate a 6-digit code every 30 seconds.</HelpDef>
          <HelpDef term="Backup codes">One-time recovery codes used to sign in if you lose your authenticator app; each code works only once.</HelpDef>
          <HelpDef term="SMS 2FA">Setting up the second step as an SMS code sent to your phone instead of an authenticator app.</HelpDef>
          <HelpDef term="Authentication method">A method shown on the login page — Google OAuth and Microsoft OAuth can be toggled on or off.</HelpDef>
          <HelpDef term="Linked account">A Google or Microsoft account connected to your LeadDrive account so you can sign in with it.</HelpDef>
          <HelpDef term="API key">A secret key for external systems to access LeadDrive data programmatically; it has read/write permissions (scopes) and an expiry.</HelpDef>
          <HelpDef term="Scope (permission)">Defines which modules a key can reach and at what level (read = read, write = write).</HelpDef>
        </dl>
        <p>
          The first card shows a green or orange shield icon, <strong>2FA Enabled</strong> / <strong>2FA Not
          Enabled</strong> text, and an <strong>Active</strong> / <strong>Inactive</strong> badge on the right.
          Below it is a "How it works" box and — depending on 2FA state — an <HelpKey>Enable 2FA</HelpKey> or{" "}
          <HelpKey>Disable 2FA</HelpKey> button.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: enable authenticator 2FA">
        <HelpStep n={1}>
          <p>
            On the status card at the top, click <HelpKey>Enable 2FA</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly shows a spinner, then a "Step 1: Scan QR Code" card opens with a large QR code
            image inside.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Open your authenticator app (Google Authenticator, Authy, etc.) and scan that QR code. If you can't
            scan, enter the key below the QR manually — you can also grab it with the copy icon next to it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Under "Can't scan? Enter this key manually:" the secret key is shown as text. When you press the
            copy button, the icon briefly turns into a green checkmark.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the field under "Step 2: Enter verification code", type the 6-digit code from your app, then
            click <HelpKey>Verify &amp; Enable</HelpKey>. (Changed your mind? <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field accepts digits only and is capped at 6. <HelpKey>Verify &amp; Enable</HelpKey> stays
            disabled until 6 digits are entered. If the code is wrong, a red error message appears below the
            field.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If the code is correct, a "2FA Enabled Successfully!" card opens and shows your backup codes. Store
            them somewhere safe — <HelpKey>Copy All Codes</HelpKey> copies them all at once. When done, click{" "}
            <HelpKey>Done</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A yellow "Save your backup codes!" box and the codes laid out in two columns. After{" "}
            <HelpKey>Done</HelpKey> you return to the status card; the shield is now green, the text reads{" "}
            <strong>2FA Enabled</strong>, and the badge shows <strong>Active</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Backup codes are shown only once on this screen, and each code works only once. If you don't copy
            and store them safely now, you won't be able to see them again later.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: disable authenticator 2FA">
        <HelpStep n={1}>
          <p>
            If 2FA is enabled, click the red <HelpKey>Disable 2FA</HelpKey> button on the status card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A (red) "Disable 2FA" card opens and asks you to enter your current 6-digit code.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type the current 6-digit code from your authenticator app, then click the red{" "}
            <HelpKey>Disable 2FA</HelpKey> button. (To back out, use <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button stays disabled until 6 digits are entered. After confirming you return to the status
            card; the shield turns orange, the text reads <strong>2FA Not Enabled</strong>, and the badge shows{" "}
            <strong>Inactive</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set up SMS 2FA">
        <HelpStep n={1}>
          <p>
            In the <strong>SMS Two-Factor Authentication</strong> section, click <HelpKey>Enable SMS 2FA</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card header has a phone icon, the title "Verify phone via SMS", and a status badge in the top
            corner (<strong>Not active</strong> / <strong>Active</strong>). Clicking the button opens a phone
            number field with the hint "Add an SMS code step after your password at login" next to it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type your number in international format in the <strong>Phone number</strong> field (e.g.{" "}
            <HelpKey>+15551234567</HelpKey>) and click <HelpKey>Send code</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Use international format" hint sits under the field. If the number is invalid, a red error
            message appears. When the code is sent, a "code sent" toast shows at the top and the form moves to
            the 6-digit code step.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Enter the 6-digit code from the SMS in the <strong>6-digit code</strong> field and click{" "}
            <HelpKey>Verify &amp; enable</HelpKey>. (To go back, use <HelpKey>Back</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The number the code was sent to is shown above. The field accepts digits only; the button stays
            disabled until 6 digits are entered. On success the card switches to a green "SMS 2FA is on" box,
            shows the masked number, and the badge reads <strong>Active</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Later, use <HelpKey>Disable SMS 2FA</HelpKey> to turn it off, or <HelpKey>Change phone</HelpKey> to
            move to a different number.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>Change phone</HelpKey> restarts the number → code flow; after disabling, the card returns
            to its initial state with the <HelpKey>Enable SMS 2FA</HelpKey> button.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: manage login methods and link accounts">
        <HelpStep n={1}>
          <p>
            In the <strong>Authentication Methods</strong> section, click the toggle on the Google OAuth and
            Microsoft OAuth cards to turn each method on or off on the login page.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows a <strong>Configured</strong> (green) or <strong>Not configured</strong> (red)
            badge next to the provider name. If a provider isn't configured on the server, its toggle is
            disabled and a yellow warning ("…are not set in the server .env") appears below.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <strong>Linked Accounts</strong> section, use <HelpKey>Link</HelpKey> to connect your own
            Google or Microsoft account to your LeadDrive account, or <HelpKey>Unlink</HelpKey> to disconnect
            it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If an account is linked, a green <strong>Connected</strong> badge appears next to the provider name
            along with a red <HelpKey>Unlink</HelpKey> button. If not linked, a <HelpKey>Link</HelpKey> button
            shows; clicking it sends you to the provider's sign-in screen, and you land back on the Security
            page afterward.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create and revoke an API key">
        <HelpStep n={1}>
          <p>
            In the <strong>API Keys</strong> section, click <HelpKey>New API Key</HelpKey> in the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An amber-bordered form opens: a <strong>Key Name</strong> field, a <strong>Scopes</strong> list
            (separate <HelpKey>read</HelpKey> and <HelpKey>write</HelpKey> buttons per module), and an{" "}
            <strong>Expires in</strong> dropdown. If you have no keys yet and the form is closed, a dashed empty
            state ("No API keys yet…") is shown instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Key Name</strong> (e.g. "My Integration"), pick the <HelpKey>read</HelpKey>/
            <HelpKey>write</HelpKey> scopes for the modules you need, and set the expiry —{" "}
            <HelpKey>30 days</HelpKey>, <HelpKey>90 days</HelpKey>, <HelpKey>1 year</HelpKey>, or{" "}
            <HelpKey>Never</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Next to the Scopes heading are <HelpKey>Select all read</HelpKey> and <HelpKey>Clear</HelpKey>
            shortcuts. A selected scope button is highlighted. If the name is empty or no scope is selected,{" "}
            <HelpKey>Generate Key</HelpKey> stays disabled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Generate Key</HelpKey> and copy the revealed key right away.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A green box reads "Key created! Copy it now — it won't be shown again." and displays the full key;
            grab it with the copy button next to it. After <HelpKey>Done</HelpKey>, the new key appears in the
            list below with an <strong>Active</strong> badge, its prefix, scope count, and expiry.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To revoke a key, click the red trash-can icon on its row in the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Revoke this API key? This cannot be undone." confirmation appears. After confirming, the key's
            badge changes from <strong>Active</strong> to <strong>Revoked</strong> and the card fades.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            The full API key is shown ONLY at creation, once — after you close the box you can't see it again.
            If you lose it, revoke the key and create a new one. Revoking a key cannot be undone.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          When creating an API key, grant only the scopes you truly need: <HelpKey>read</HelpKey> is enough for
          most integrations, and you should add <HelpKey>write</HelpKey> only if the system must change data.
          Setting an expiry (e.g. <HelpKey>90 days</HelpKey>) narrows the risk window even if a key leaks.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          2FA and linked accounts belong to your personal account. <strong>Authentication methods</strong>, on
          the other hand, are organization-level — disabling Google/Microsoft sign-in affects the
          organization's login page. Google/Microsoft can only be turned on once the matching <code>.env</code>{" "}
          variables (CLIENT_ID / CLIENT_SECRET) are configured on the server. API keys grant programmatic access
          to your organization's data — guard them like a password.
        </p>
      </HelpCallout>
    </div>
  )
}
