"use client"

/**
 * Integrations & API Keys — help article (English).
 *
 * Covers the two settings pages that let external systems talk to the CRM:
 * Settings → Integrations (webhooks, Google Calendar, Slack, Zapier) and
 * Settings → API Keys (programmatic Bearer-token access). One article wired
 * to both page headers — the same broad-topic pattern as support / list-power.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function IntegrationsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          Two settings pages connect your CRM to the outside world.{" "}
          <strong>Integrations</strong> pushes data <em>out</em> — webhooks fire on
          events, Google Calendar syncs, Slack gets notified. <strong>API Keys</strong>{" "}
          lets external systems read and write your data <em>in</em>, over the REST API.
        </p>
        <p>
          Everything here is scoped to your organization. A webhook only ever sees your
          tenant&apos;s events, and an API key only ever touches your tenant&apos;s data.
        </p>
      </HelpSection>

      <HelpSection title="Webhooks — push events to any URL">
        <p>
          A webhook posts a JSON payload to a URL you control whenever a chosen event
          happens. Pick the events you care about; LeadDrive does the calling.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Contacts">contact.created, contact.updated, contact.deleted</HelpDef>
          <HelpDef term="Deals">deal.created, deal.updated, deal.stage_changed</HelpDef>
          <HelpDef term="Leads">lead.created, lead.updated</HelpDef>
          <HelpDef term="Tickets">ticket.created, ticket.updated, ticket.resolved</HelpDef>
          <HelpDef term="Companies">company.created, company.updated</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Press <HelpKey>Add Webhook</HelpKey>, paste the destination URL, and tick the
            events that should trigger it (at least one). Save with{" "}
            <HelpKey>Create Webhook</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On creation you get a <strong>signing secret</strong> shown once — copy it. The
            green / grey dot beside each webhook toggles it <em>active</em> or{" "}
            <em>inactive</em>; the trash icon deletes it.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Each delivery is a <HelpKey>POST</HelpKey> with a JSON body{" "}
            <code>{`{ event, timestamp, organizationId, data }`}</code> and three headers:{" "}
            <HelpKey>X-Webhook-Signature</HelpKey> (HMAC-SHA256 of the body, keyed with your
            secret), <HelpKey>X-Webhook-Event</HelpKey>, and{" "}
            <HelpKey>X-Webhook-Attempt</HelpKey>.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Always <strong>verify the signature</strong> before trusting a payload:
            recompute HMAC-SHA256 of the raw body with your secret and compare to{" "}
            <HelpKey>X-Webhook-Signature</HelpKey>. Delivery retries up to 3 times with
            backoff (1s, 4s, 16s) on network errors or 5xx / 429; a 4xx response (other than
            429) is treated as a permanent failure and isn&apos;t retried. Requests to
            private / internal URLs are blocked (SSRF protection), so the destination must be
            publicly reachable.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Zapier &amp; no-code tools">
        <p>
          There&apos;s no separate Zapier setup — point a webhook at the URL Zapier (or
          Make, n8n, or any catch-hook tool) gives you, and every matching event flows
          straight in. The same applies to any platform that can receive an HTTP POST.
        </p>
        <HelpCallout kind="tip">
          <p>
            The webhook URL field even pre-fills a{" "}
            <HelpKey>https://hooks.zapier.com/…</HelpKey> placeholder as a hint. Paste the
            real catch-hook URL there.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Google Calendar — two-way sync">
        <p>
          Connecting Google Calendar links <em>your</em> Google account to LeadDrive via
          OAuth, with read and write access to calendar events.
        </p>
        <HelpStep n={1}>
          <p>
            Press <HelpKey>Connect</HelpKey> on the Google Calendar card. You&apos;re sent to
            Google&apos;s consent screen; approve, and you land back on this page with the
            card showing <em>Connected</em>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Disconnect</HelpKey> (with a confirm prompt) removes the stored
            authorization. The connection is <strong>per user</strong> — each teammate
            connects their own calendar.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Google Calendar needs Google OAuth credentials configured on the server. If they
            aren&apos;t set up, <HelpKey>Connect</HelpKey> can&apos;t complete and the card
            stays <em>Not connected</em> — ask your administrator.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Slack — notifications to a channel">
        <p>
          Slack uses an <strong>incoming webhook URL</strong> you create in your Slack
          workspace. LeadDrive posts messages to whatever channel that URL targets.
        </p>
        <HelpStep n={1}>
          <p>
            Create an incoming webhook in Slack, then press{" "}
            <HelpKey>Add Slack Webhook</HelpKey> here, give it a name, paste the{" "}
            <HelpKey>https://hooks.slack.com/services/…</HelpKey> URL, and save with{" "}
            <HelpKey>Add Integration</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Use <HelpKey>Test</HelpKey> to send a one-off check message into the channel —{" "}
            <em>Test sent!</em> confirms the URL works. The trash icon removes a
            configuration.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            You can add several Slack configurations (e.g. one channel for deals, another for
            tickets). Each is just a named incoming-webhook URL.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="API Keys — programmatic access">
        <p>
          An API key is a <strong>Bearer token</strong> that lets an external system call
          the LeadDrive REST API as your organization. Each key carries a set of{" "}
          <strong>scopes</strong> that limit exactly what it can do.
        </p>
        <HelpStep n={1}>
          <p>
            Press <HelpKey>Create Key</HelpKey>, give it an internal name, optionally set an
            expiry (<em>Never</em>, 30, 90, or 365 days), and tick the scopes the integration
            needs. A name and at least one scope are required.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Scopes come as <HelpKey>read:&lt;module&gt;</HelpKey> and{" "}
            <HelpKey>write:&lt;module&gt;</HelpKey> per module (contacts, deals, leads,
            tickets, invoices, and so on). A <em>write</em> scope also satisfies a{" "}
            <em>read</em> on the same module. Grant only what&apos;s needed —{" "}
            <strong>least privilege</strong>.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            The full key (prefixed <HelpKey>ld_</HelpKey>) is shown <strong>once</strong>,
            right after creation, with a copy button and a ready-made{" "}
            <code>curl -H &quot;Authorization: Bearer ld_…&quot;</code> example. Use it in
            the <HelpKey>Authorization: Bearer</HelpKey> header on your requests.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Copy the key before you close the dialog</strong> — only a short prefix is
            stored, the full key is hashed and never shown again. Lose it and you must create
            a new one.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Managing &amp; revoking keys">
        <p>
          The list shows each key&apos;s prefix, an <em>Active</em> or <em>revoked</em>{" "}
          badge, its scope count, when it was last used, when it expires, and when it was
          created.
        </p>
        <HelpStep n={1}>
          <p>
            The trash icon <strong>revokes</strong> a key (after a confirm). Revocation is
            immediate — any integration using that key stops working at once.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            A request also fails if the key is past its <strong>expiry</strong>, or if it
            lacks the scope for the module and method being called. The{" "}
            <HelpKey>Last used</HelpKey> timestamp updates on every successful call, so you
            can spot keys that are stale or unexpectedly active.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Only <strong>admins</strong> (and superadmins) can create or revoke API keys;
            other roles can&apos;t even open the create dialog. A revoked key can&apos;t be
            un-revoked — issue a fresh one and update the integration. Treat keys like
            passwords: store them in a secret manager, never in source control.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="How they fit together">
        <ol className="list-decimal pl-5 space-y-1">
          <li>A deal moves stage → a <strong>webhook</strong> POSTs the event to your URL.</li>
          <li>Your automation tool (Zapier / Make / custom) receives it and reacts.</li>
          <li>To write back — create a record, update a contact — it calls the REST API with an <strong>API key</strong> scoped to just that module.</li>
          <li>Meanwhile <strong>Slack</strong> and <strong>Google Calendar</strong> keep your team&apos;s channel and schedule in the loop.</li>
        </ol>
      </HelpSection>
    </div>
  )
}
