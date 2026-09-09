"use client"

/**
 * MTM Settings — help article (English).
 *
 * Covers the Route & Field (MTM) settings page at /mtm/settings: seven
 * setting groups (Company, GPS Tracking, Visit Settings, Working Hours,
 * Telegram Bot, Integrations, Report Settings), how values are stored
 * per-organization, the server-side defaults, who may save, and the
 * audit trail. Wired to the MTM Settings page header.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmSettingsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="What this page is">
        <p>
          <strong>MTM Settings</strong> is the one place to tune how your{" "}
          <strong>Route &amp; Field</strong> team works — GPS tracking cadence, geofence size,
          visit rules, working hours, alerts, the Telegram bot, integrations, and daily reports.
        </p>
        <p>
          Every setting is stored <strong>per organization</strong>, so a value you change here
          applies to your whole field team and nothing leaks across tenants. The page loads your
          current values on open; nothing changes until you press{" "}
          <HelpKey>Save</HelpKey>.
        </p>
      </HelpSection>

      <HelpSection title="How saving works">
        <HelpStep n={1}>
          <p>
            Edit any field across the cards. Toggles flip on/off, text fields take free text,
            number fields take whole numbers, and time fields take a clock value (HH:MM).
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Press <HelpKey>Save</HelpKey> once — the whole form is sent together and each setting
            is written as its own keyed record. Re-saving an existing setting overwrites it; it
            does not create duplicates.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            On success you&apos;ll see a <em>Settings saved</em> confirmation. If a save fails, the
            error is shown and nothing on the server is half-applied — fix it and save again.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            <strong>Saving is permission-gated.</strong> Only <strong>admin</strong>,{" "}
            <strong>manager</strong>, and <strong>superadmin</strong> roles may write these
            settings; anyone else is blocked with a <em>Forbidden</em> response. Every save is also
            recorded in the MTM audit log (which keys changed, plus the request IP and device).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="GPS Tracking &amp; Visit Settings">
        <p>
          These two groups control how the field app tracks location and what an agent must do at a
          customer site. Several of them ship with sensible defaults until you override them.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="GPS interval">How often a location ping is taken, in seconds. Default 30.</HelpDef>
          <HelpDef term="Geofence radius">The check-in zone around a customer, in meters. Default 100.</HelpDef>
          <HelpDef term="GPS spoofing">Toggle an alert when a faked location is detected. On by default.</HelpDef>
          <HelpDef term="Photo required">Legacy fallback that requires one photo when no visit policy matches. Off by default.</HelpDef>
          <HelpDef term="Max photos">Cap on photos per visit. Default 10.</HelpDef>
          <HelpDef term="Open visit alert">Minutes after which an open visit raises an alert. It remains open until the agent completes it. Default 120.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Working Hours &amp; alerts">
        <p>
          Set the team&apos;s <strong>Start time</strong> and <strong>End time</strong> (HH:MM,
          defaulting to 09:00–18:00), then switch on the alerts you care about:{" "}
          <em>late start</em> and <em>missed visit</em> are both on by default.
        </p>
        <HelpCallout kind="tip">
          <p>
            The GPS-spoofing, late-start and missed-visit alerts are the three that come pre-enabled
            — leave them on unless you have a specific reason not to. They&apos;re your early-warning
            signal that something on a route needs attention.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Telegram Bot, Integrations &amp; Reports">
        <p>
          The last three groups are <strong>opt-in</strong> — they have no defaults, so every field
          starts empty and every toggle starts off until you fill them in and save.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Telegram Bot">Enable it, then store a bot token and a chat/group ID, and choose whether to notify on check-in and on alerts.</HelpDef>
          <HelpDef term="Integrations">Webhook URL plus an enable toggle, an API-key access toggle, and an external-CRM sync toggle.</HelpDef>
          <HelpDef term="Reports">Auto-generate a daily report, email reports to admins at a set send time, and optionally include photos.</HelpDef>
        </dl>
        <HelpCallout kind="warning">
          <p>
            The <strong>bot token</strong> and <strong>webhook URL</strong> are credentials — paste
            them carefully and treat them like passwords. They&apos;re stored against your
            organization only, but a wrong or leaked token means notifications go to the wrong place.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Routes Phase 1 rollout controls">
        <p>
          Three switches let an administrator roll out multi-agent route assignments, visit action policies,
          and Excel imports independently. Turning a switch off blocks new use of that capability without
          deleting existing routes, policies or import history. Excel import still remains admin-only unless
          manager import access is enabled separately.
        </p>
      </HelpSection>

      <HelpSection title="Company branding">
        <p>
          The <strong>Company</strong> group holds a company name, a primary color, and a logo URL.
          Like the other opt-in groups it starts empty — fill it in to label the field-team
          experience with your own identity.
        </p>
      </HelpSection>

      <HelpCallout kind="next">
        <p>
          Once tracking, hours and alerts are dialed in, head back to the Route &amp; Field screens —
          new visits, geofences and long-open-visit alerts will follow the rules you set here. Revisit this
          page whenever your team&apos;s schedule or tracking policy changes.
        </p>
      </HelpCallout>
    </div>
  )
}
