"use client"

/**
 * Web-to-Lead — help article (English).
 * Covers only the Settings → Web-to-Lead page: form configuration
 * (org slug, form title, button text, redirect URL, field badges),
 * the API Endpoint card, copying the embed code, and the live preview.
 * The page is a form builder — nothing is saved here, everything
 * generates code in real time.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function WebToLeadHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a marketing or operations admin"
        goal="Generate a ready-made contact form to drop into your own website — so that when a visitor submits it, a lead is created automatically in LeadDrive"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Web-to-Lead</HelpKey>. This page is a{" "}
        <strong>form builder</strong>: you change the settings on the left, and the code and preview on the
        right update instantly. Nothing is saved here — you copy the generated HTML and paste it into your
        own site, and leads flow straight from your site&apos;s form into LeadDrive.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Web-to-Lead</HelpKey> title with a globe icon, with «Configure lead
          capture forms» beneath it and the hint «Web forms that automatically create leads from your website
          visitors». Below that the page splits into two columns. The left column has two cards:{" "}
          <strong>Form Configuration</strong> and <strong>API Endpoint</strong>. The right column also has
          two cards: <strong>Embed Code</strong> and <strong>Preview</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Organization Slug">
            The short name that tells the form which organization the lead belongs to. LeadDrive fills it from
            the current tenant when you are signed in; change it only if support asks you to target another
            tenant.
          </HelpDef>
          <HelpDef term="Form Title">
            The heading shown at the top of the form. Defaults to <HelpKey>Contact Us</HelpKey>.
          </HelpDef>
          <HelpDef term="Submit Button Text">
            The text on the submit button. Defaults to <HelpKey>Submit</HelpKey>.
          </HelpDef>
          <HelpDef term="Redirect URL (optional)">
            Optional — the page a visitor is sent to after a successful submission (e.g. a «thank you» page).
            Leave it blank and the visitor sees a thank-you alert instead.
          </HelpDef>
          <HelpDef term="Fields">
            The form fields, shown as badges: <strong>Name *</strong> and <strong>Email *</strong> are always
            present (required, can&apos;t be turned off), while <strong>Phone</strong>, <strong>Company</strong>,
            and <strong>Message</strong> are added or removed by clicking.
          </HelpDef>
          <HelpDef term="API Endpoint">
            The address the form posts to — <HelpKey>POST</HelpKey> to <code>/api/v1/public/leads</code>. CORS
            is enabled, with a limit of 10 requests per minute per IP.
          </HelpDef>
          <HelpDef term="Embed Code">
            The full auto-generated HTML + JavaScript. The code updates live as you change the settings.
          </HelpDef>
          <HelpDef term="Preview">
            A live preview of how the form actually looks (not the code) — every field is disabled, it&apos;s for
            display only.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: configure the form">
        <HelpStep n={1}>
          <p>
            In the <strong>Form Configuration</strong> card on the top-left, check the{" "}
            <HelpKey>Organization Slug</HelpKey> field. It should already show the current tenant slug.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, the <code>org_slug</code> value inside the <strong>Embed Code</strong> on the right
            changes to match instantly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a heading into <HelpKey>Form Title</HelpKey> (e.g. «Contact Us»), then set the button label in{" "}
            <HelpKey>Submit Button Text</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Preview</strong> card on the right updates the form title and button text in real time
            as you type; the same values flow into the <strong>Embed Code</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally type a full address into <HelpKey>Redirect URL (optional)</HelpKey> (e.g.{" "}
            <HelpKey>https://yoursite.com/thank-you</HelpKey>). Leave it blank and the visitor will see a
            thank-you alert.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Only an address starting with <code>http://</code> or <code>https://</code> is accepted — with a
            valid URL the submit part of the code switches to a redirect line, otherwise it keeps the
            thank-you alert line.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            In the <HelpKey>Fields</HelpKey> section, click the badges to toggle the optional fields on or off:{" "}
            <HelpKey>Phone</HelpKey>, <HelpKey>Company</HelpKey>, <HelpKey>Message</HelpKey>. (The{" "}
            <strong>Name *</strong> and <strong>Email *</strong> badges are always on and can&apos;t be toggled.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An active badge is filled (default style); a toggled-off one is just outlined. Below them is the
            hint «Click badges to toggle optional fields». A field you turn off disappears immediately from both
            the <strong>Preview</strong> and the <strong>Embed Code</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: copy the code and embed it on your site">
        <HelpStep n={1}>
          <p>
            In the <strong>Embed Code</strong> card on the top-right, check that the settings look right — the
            card is marked with a code icon and shows all of the HTML + JavaScript.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The code block starts with the comment «&lt;!-- LeadDrive Web-to-Lead Form --&gt;» and contains the
            form, your chosen fields, and the submit script. It updates instantly as you change the settings on
            the left.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the <HelpKey>Copy</HelpKey> button in the top-right of the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly switches to <HelpKey>Copied!</HelpKey> (with a check icon), then changes back to{" "}
            <HelpKey>Copy</HelpKey> after about two seconds. The code is now on your clipboard.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Paste the copied code into your website&apos;s HTML, wherever you want the form to appear.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form on your site looks just like the <strong>Preview</strong>. When a visitor fills it in and
            submits, the data is POSTed to the address shown in the <strong>API Endpoint</strong> card and a new
            lead is created in LeadDrive.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          This page doesn&apos;t save anything — it only generates code. If you change the configuration and{" "}
          <HelpKey>Copy</HelpKey> again, you&apos;ll need to replace the old code on your site with the new one. Set
          the title, button text, and fields up first, then copy it all in one go.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Make sure the <HelpKey>Organization Slug</HelpKey> matches your own organization before copying the
          code. Also, the{" "}
          <strong>API Endpoint</strong> accepts only <strong>10 requests per minute per IP</strong>; keep that
          limit in mind for high-traffic pages.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The endpoint is public (<HelpKey>POST /api/v1/public/leads</HelpKey>) and CORS is enabled so the form
          works from any site — but to limit abuse there&apos;s a rate limit of 10 requests per minute per IP. The
          form title, button text, and slug are safely HTML-escaped when the code is generated, and the redirect
          URL only allows <code>http/https</code> protocols — which prevents code injection.
        </p>
      </HelpCallout>
    </div>
  )
}
