"use client"

/**
 * VoIP Settings — help article (English).
 *
 * Covers Settings → VoIP (/settings/voip): one screen that connects your
 * telephony provider so the CRM can place click-to-call calls, log them
 * against contacts/deals, and optionally record. Four providers behind one
 * unified config: Twilio, 3CX, Asterisk, and Custom SIP.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SettingsVoipHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          This screen connects your <strong>telephony provider</strong> to the CRM. Once it&apos;s
          set up, a phone number on a contact or deal becomes a one-click call, every call is{" "}
          <strong>logged automatically</strong> against that record, and — if you turn it on —
          calls can be <strong>recorded</strong>.
        </p>
        <p>
          You configure exactly <strong>one</strong> provider per organization. Pick the one your
          team already uses, fill in its credentials, save, and switch it on.
        </p>
      </HelpSection>

      <HelpSection title="Pick your provider">
        <p>
          The <HelpKey>VoIP Provider</HelpKey> dropdown offers four options. Each one expects a
          different set of credentials, so the form below it changes when you switch.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Twilio">
            Cloud telephony — best for global coverage and the easiest setup. Needs a Twilio
            account with a purchased phone number.
          </HelpDef>
          <HelpDef term="3CX">
            On-premise or cloud PBX, connected through the 3CX Call Control API.
          </HelpDef>
          <HelpDef term="Asterisk">
            Self-hosted open-source PBX, connected through the Asterisk REST Interface (ARI).
          </HelpDef>
          <HelpDef term="Custom SIP">
            Browser-based calling via SIP.js against any standards-compliant SIP server over a
            WebSocket (WSS) connection.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Fill in the credentials">
        <p>
          The second card shows only the fields your chosen provider needs. Secret fields
          (auth tokens, passwords, the SIP secret) are entered as password inputs.
        </p>
        <HelpStep n={1}>
          <p>
            <strong>Twilio</strong> — <HelpKey>Account SID</HelpKey>, <HelpKey>Auth Token</HelpKey>,
            and the <HelpKey>Twilio Phone Number</HelpKey> you place outbound calls from.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>3CX</strong> — <HelpKey>Server URL</HelpKey> (e.g.{" "}
            <em>https://mycompany.3cx.eu</em>), the <HelpKey>Extension</HelpKey> that places calls,
            and your <HelpKey>API Key</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Asterisk</strong> — <HelpKey>ARI Host</HelpKey> and <HelpKey>ARI Port</HelpKey>{" "}
            (default 8088), <HelpKey>Username</HelpKey> / <HelpKey>Password</HelpKey>, the{" "}
            <HelpKey>Dialplan Context</HelpKey> (default <em>from-internal</em>), and the{" "}
            <HelpKey>Caller Extension</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Custom SIP</strong> — <HelpKey>SIP Server</HelpKey> and{" "}
            <HelpKey>SIP Port</HelpKey> (default 5060), <HelpKey>SIP Domain</HelpKey>, the{" "}
            <HelpKey>Transport</HelpKey> (WSS, TLS, TCP, or UDP), and{" "}
            <HelpKey>Username</HelpKey> / <HelpKey>Secret</HelpKey>.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Below the fields are two switches. <strong>Record Calls</strong> asks the provider to
            record outbound calls; <strong>Enable VoIP</strong> activates the configuration so the
            rest of the CRM can use it. A header badge shows{" "}
            <HelpKey>Active</HelpKey> or <HelpKey>Inactive</HelpKey> once a config exists.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Save, then test">
        <HelpStep n={1}>
          <p>
            Press <HelpKey>Save</HelpKey>. The first save creates the configuration; later saves
            update it in place. You&apos;ll see a confirmation when it succeeds.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Press <HelpKey>Test Connection</HelpKey> to check the credentials against the live
            provider. The result appears inline — a green tick for success, a red mark with the
            provider&apos;s error message on failure.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Test Connection only works on a saved, enabled config.</strong> The button
            stays disabled until you&apos;ve saved at least once, and the test reads the{" "}
            <em>active</em> VoIP configuration from the server — so turn on{" "}
            <strong>Enable VoIP</strong> and save before testing. What each test checks differs by
            provider: Twilio verifies your account credentials, 3CX checks the extension is
            reachable, Asterisk queries ARI for its version, and Custom SIP pings the server&apos;s
            WSS/TLS port (UDP/TCP can only be validated for completeness, not reached).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="What happens after it&apos;s on">
        <p>
          With an active provider, placing a call from a contact, company, or deal creates a{" "}
          <strong>call log</strong> entry — direction, the from/to numbers, the provider, the
          linked record, and who placed it — before the call is even initiated.
        </p>
        <HelpStep n={1}>
          <p>
            <strong>Twilio, 3CX, and Asterisk</strong> place the call on the server side through
            the provider&apos;s API.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Custom SIP</strong> dials from the browser via SIP.js — the server just hands
            the client the configuration it needs and records the log.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Call logs and call history live with the records they belong to (Contacts → Calls), not
            on this settings page. This screen is only where the connection is configured.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          The VoIP configuration is scoped to your organization — your credentials and call logs
          never cross into another tenant. Provider secrets are sent only when you save and are
          used server-side to reach your telephony system; treat the auth token, ARI password, and
          SIP secret like any other credential and rotate them at the provider if they leak.
        </p>
      </HelpCallout>
    </div>
  )
}
