"use client"

/**
 * Custom Domains — help article (English).
 * Covers Settings → Custom Domains: connect your own domain, set up the
 * CNAME record, verify DNS, statuses (Pending / DNS Verified / Active / Error),
 * and delete a domain. Landing pages go live on your own branded domain.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CustomDomainsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a marketing or operations admin"
        goal="Serve your landing pages on your own branded domain (e.g. landing.yourcompany.com) instead of a generic URL"
      >
        Reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>Custom Domains</HelpKey>. All domains
        belong to your organization only. Setup has three parts: you add the domain here, you create one
        CNAME record at your DNS provider, then you come back and confirm with <HelpKey>Verify DNS</HelpKey>.
        The CNAME has to be added outside LeadDrive — in the control panel of the provider where you
        bought the domain.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a globe icon with <HelpKey>Custom Domains</HelpKey>, the line "Connect your
          own domain to serve landing pages" below it, and an <HelpKey>Add Domain</HelpKey> button at top
          right. Below sits an always-visible <strong>"How Custom Domains Work"</strong> three-step guide
          (step 2 includes a CNAME example with a copy button), then an <strong>"Example Setup"</strong>{" "}
          card, and at the bottom the domain list — or, if you have no domains yet, an empty state.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Domain">The subdomain you connect for your landing pages, e.g. landing.yourcompany.com.</HelpDef>
          <HelpDef term="CNAME record">The redirect you create at your DNS provider — it points your domain at our target (pages.leaddrivecrm.org).</HelpDef>
          <HelpDef term="Pending">Domain added but DNS not yet verified (yellow badge, clock icon).</HelpDef>
          <HelpDef term="DNS Verified">The CNAME was found and is correct; SSL not yet issued (blue badge).</HelpDef>
          <HelpDef term="Active">SSL certificate issued, the domain is fully live (green badge, shield icon).</HelpDef>
          <HelpDef term="Error">Verification failed; a red error message shows under the row.</HelpDef>
        </dl>
        <p>
          The domain list is a table with <strong>Domain</strong> (with a server icon, in monospace),{" "}
          <strong>Status</strong> (colored badge), <strong>Added</strong> (date), and{" "}
          <strong>Actions</strong> columns. When the status is <HelpKey>Pending</HelpKey> or{" "}
          <HelpKey>Error</HelpKey>, a <HelpKey>Verify DNS</HelpKey> button appears in the row; every row
          has a red trash (delete) button. When a domain is <HelpKey>Active</HelpKey>, a small
          open-in-new-tab icon shows next to the name.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: add a domain">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Add Domain</HelpKey> at top right. (If you have no domains yet, the same
            button in the middle of the empty state works too.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Add Custom Domain" dialog opens. It has a <strong>Domain</strong> text field (with a
            "landing.yourcompany.com" placeholder), the hint "Use a subdomain like
            landing.yourcompany.com or pages.yourcompany.com" below it, and <HelpKey>Cancel</HelpKey> /{" "}
            <HelpKey>Add</HelpKey> buttons at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type the domain (e.g. <HelpKey>landing.yourcompany.com</HelpKey>) and click{" "}
            <HelpKey>Add</HelpKey>. Pressing Enter also submits.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <HelpKey>Add</HelpKey> button stays disabled while the field is empty. After you submit,
            the domain is saved in lowercase; on success a "Domain added" toast appears, the dialog
            closes, and the domain shows up in the table with <HelpKey>Pending</HelpKey> status. If the
            domain already exists or is invalid, a red error toast appears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set up and verify DNS">
        <HelpStep n={1}>
          <p>
            Look at the CNAME block in step 2 of the "How Custom Domains Work" guide. It shows{" "}
            <strong>Record Type</strong> = <HelpKey>CNAME</HelpKey>, <strong>Host / Name</strong> = your
            subdomain, and <strong>Value / Target</strong> = <HelpKey>pages.leaddrivecrm.org</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking the copy icon next to the target copies the value to your clipboard, the icon briefly
            turns into a green checkmark, and a "Copied to clipboard!" toast appears. Below the block is
            the note "DNS propagation can take up to 48 hours."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Go to your DNS provider's control panel (the service where you bought the domain) and create
            a new <strong>CNAME</strong> record: host = your subdomain, value ={" "}
            <HelpKey>pages.leaddrivecrm.org</HelpKey>. Save the change.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            This step happens outside LeadDrive, in the provider's own panel. For a reference, look at the
            "Example Setup" card on the page: <strong>landing.yourcompany.com</strong> →{" "}
            <strong>CNAME</strong> → <strong>pages.leaddrivecrm.org</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Back in LeadDrive, click <HelpKey>Verify DNS</HelpKey> on the domain's row (this button only
            appears for domains in <HelpKey>Pending</HelpKey> or <HelpKey>Error</HelpKey> status).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Verifying..." with a spinning icon. If the record is found, a "DNS
            verified successfully!" toast appears and the status advances; if not, "DNS verification
            failed. Make sure CNAME points to pages.leaddrivecrm.org" shows and the status may become{" "}
            <HelpKey>Error</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Wait until the status reads <HelpKey>Active</HelpKey> — the SSL certificate is issued
            automatically after verification, no extra action needed.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge changes to <HelpKey>Active</HelpKey> with a green shield icon, and an
            open-in-new-tab icon appears next to the domain name. From then on, visitors see your landing
            pages on your own domain.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: delete a domain">
        <HelpStep n={1}>
          <p>
            Click the red trash icon button at the right of the domain's row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog titled "Are you sure you want to remove this domain?" opens. It states
            "Landing pages will no longer be accessible on this domain", shows the domain name in
            monospace, and offers <HelpKey>Cancel</HelpKey> and a red <HelpKey>Delete</HelpKey> button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm by clicking the red <HelpKey>Delete</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Domain removed" toast appears, the dialog closes, and the domain disappears from the table.
            If it was your last domain, the page shows the empty state again.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Use a subdomain rather than a bare domain (e.g. <HelpKey>landing.yourcompany.com</HelpKey> or{" "}
          <HelpKey>pages.yourcompany.com</HelpKey>) — that lets you serve landing pages separately without
          touching your main website.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          DNS propagation can take <strong>up to 48 hours</strong>. If you just added the CNAME and
          verification fails, that's normal — wait a while and try <HelpKey>Verify DNS</HelpKey> again.
          Double-check the target is exactly <HelpKey>pages.leaddrivecrm.org</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All domains are scoped to your organization — you only see and manage your own tenant's
          domains. The SSL certificate is issued automatically once the domain verifies; you don't need
          to upload a certificate manually.
        </p>
      </HelpCallout>
    </div>
  )
}
