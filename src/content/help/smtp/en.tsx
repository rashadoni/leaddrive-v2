"use client"

/**
 * SMTP Settings — help article (English).
 *
 * Covers the single settings page at /settings/smtp-settings: the managed
 * email banner, quick presets, the per-tenant SMTP form (host/port/TLS/auth/
 * From), the Gmail App-Password path, Save, and the Test Email check.
 * Only what is confirmable in page.tsx + /api/v1/settings/smtp(/test) is
 * described.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SmtpHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          LeadDrive already sends email for you. Transactional messages —
          registration, password reset, ticket notifications — go out centrally
          from <strong>no-reply@mail.leaddrivecrm.org</strong> with your
          organization name in the From header, and client replies turn into
          ticket comments automatically.
        </p>
        <p>
          The SMTP form on this page is an <strong>optional fallback</strong>:
          fill it in only if you want outbound email to leave from your own
          domain. Most organizations never need to touch it.
        </p>
      </HelpSection>

      <HelpSection title="When to set up your own SMTP">
        <p>
          Connect a server only when From has to read as your domain — for
          example, you want customers to see <em>billing@yourcompany.com</em>{" "}
          rather than the managed address. If that&apos;s not a requirement,
          leave the form blank and rely on managed email.
        </p>
        <p>
          A <HelpKey>Configured</HelpKey> badge appears next to the title once a
          host, login, and password are saved, so you can tell at a glance
          whether your own server is in play.
        </p>
      </HelpSection>

      <HelpSection title="Quick presets">
        <p>
          Four buttons fill in the host, port, and TLS for common providers so
          you only have to add credentials:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Gmail">smtp.gmail.com · port 587 · TLS on</HelpDef>
          <HelpDef term="Yandex">smtp.yandex.ru · port 465 · TLS on</HelpDef>
          <HelpDef term="Mail.ru">smtp.mail.ru · port 465 · TLS on</HelpDef>
          <HelpDef term="Outlook">smtp.office365.com · port 587 · TLS on</HelpDef>
        </dl>
        <p>
          A preset only sets server, port, and TLS — you still enter the login,
          password, and From details yourself.
        </p>
      </HelpSection>

      <HelpSection title="Fill in the connection">
        <dl className="rounded-md border p-3">
          <HelpDef term="SMTP Server">Host address, e.g. smtp.gmail.com</HelpDef>
          <HelpDef term="Port">587 for TLS or 465 for SSL — 25 is often blocked</HelpDef>
          <HelpDef term="Use TLS">Yes / No — usually Yes for port 587</HelpDef>
          <HelpDef term="Login">SMTP username, usually your email address</HelpDef>
          <HelpDef term="Password">SMTP password or an app-specific password</HelpDef>
          <HelpDef term="From Email">Address recipients see as sender</HelpDef>
          <HelpDef term="From Name">Display name shown to recipients</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Pick a preset or type the <HelpKey>SMTP Server</HelpKey> and{" "}
            <HelpKey>Port</HelpKey> by hand, then set <HelpKey>Use TLS</HelpKey>.
            Port 465 is treated as SSL automatically; the TLS toggle covers
            port 587.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Enter your <HelpKey>Login</HelpKey> and <HelpKey>Password</HelpKey>,
            then the <HelpKey>From Email</HelpKey> and{" "}
            <HelpKey>From Name</HelpKey>. If you leave From Email empty it falls
            back to the login address.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Press <HelpKey>Save Settings</HelpKey>. The button stays disabled
            until server, login, and password are all filled in.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Using Gmail?</strong> A regular Gmail password will not
            work. Turn on two-factor authentication, create an{" "}
            <strong>App Password</strong> at{" "}
            <strong>myaccount.google.com/apppasswords</strong> (choose
            &quot;Mail&quot;), and paste the 16-character code into the password
            field. The page shows this reminder as soon as your host contains
            &quot;gmail&quot;.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Send a test email">
        <HelpStep n={1}>
          <p>
            Save your settings first — <HelpKey>Send Test Email</HelpKey> stays
            disabled until the connection is configured.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type any address into <HelpKey>Test email address</HelpKey> and
            press <HelpKey>Send Test Email</HelpKey>. LeadDrive opens a live
            connection to your server and sends a branded confirmation message
            listing the server, sender, and timestamp.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            If the test fails, the error tells you what went wrong:{" "}
            <em>could not connect</em> (wrong host or port),{" "}
            <em>authorization error</em> (wrong login or password),{" "}
            <em>connection timeout</em> (server not responding), or an{" "}
            <em>SSL certificate</em> problem (try turning TLS off). Fix the
            field it points at and re-save.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Saving SMTP settings requires the <strong>settings</strong> write
          permission, and everything is scoped to your organization. Your
          password is stored on the server and never sent back to the browser —
          it always loads as a masked <code>••••••••</code>. Leave that mask
          untouched when you save and the existing password is kept; clear it
          and type a new one to replace it. The test endpoint also strips line
          breaks from the From fields to block email header injection.
        </p>
      </HelpCallout>
    </div>
  )
}
