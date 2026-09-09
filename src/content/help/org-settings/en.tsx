"use client"

/**
 * Organization Settings — help article (English).
 * Covers only Settings → Organization: editing the company name and logo URL
 * (the editable card) plus the read-only plan, user/contact limits and slug.
 * The plan-info card is NOT editable here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function OrgSettingsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are an organization administrator"
        goal="Update the company name and logo shown across the CRM, and see your current plan and user/contact limits in one place"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Organization</HelpKey>. Every
        change applies only to your own organization (tenant). The page has two cards: one editable
        (name and logo) and one read-only plan-information card.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a building icon with the title <HelpKey>Organization</HelpKey> and the
          subtitle «Company name, logo & plan details». Below it are two cards. The first card is{" "}
          <strong>Company Details</strong> — it holds the <strong>Organization Name</strong> and{" "}
          <strong>Logo URL</strong> fields with a <HelpKey>Save</HelpKey> button below them. The second
          card is <strong>Plan &amp; Limits</strong> — it shows three tiles (current plan, max users,
          max contacts) and the slug; this card is informational only and cannot be edited.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Organization Name">The company name shown throughout the CRM. It cannot be empty when saving.</HelpDef>
          <HelpDef term="Logo URL">A direct link to your company logo image (PNG, JPG, or SVG). When you enter one, a live preview appears beneath the field.</HelpDef>
          <HelpDef term="Current Plan">Your organization's tier — Starter, Business, Professional or Enterprise — shown as a colored badge.</HelpDef>
          <HelpDef term="Max Users">The user limit allowed by your plan; an ∞ symbol is shown when there is no limit.</HelpDef>
          <HelpDef term="Max Contacts">The contact limit allowed by your plan; an ∞ symbol is shown when there is no limit.</HelpDef>
          <HelpDef term="Slug">The organization's unique short identifier (used for the subdomain). Read-only, shown in monospace text.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: update the company name and logo">
        <HelpStep n={1}>
          <p>
            In the <strong>Company Details</strong> card, type your company name into the{" "}
            <HelpKey>Organization Name</HelpKey> field (e.g. "My Company LLC").
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text appears in the field as you type. If the field is empty, the <HelpKey>Save</HelpKey>{" "}
            button below stays disabled (not clickable).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Optionally paste a direct image address into the <HelpKey>Logo URL</HelpKey> field (e.g.{" "}
            <HelpKey>https://example.com/logo.png</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The hint «Direct link to your company logo image (PNG, JPG, SVG)» sits under the field. With
            a valid URL, a small framed live preview of the logo opens right below. If the image fails
            to load (a bad URL), the preview simply isn't shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to <strong>Saving...</strong> with a spinning icon. On success a green
            confirmation bar appears with the message <strong>Organization settings saved
            successfully</strong>. On failure, a red bar shows the error text instead.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Check your plan and limits">
        <HelpStep n={1}>
          <p>
            The second card — <strong>Plan &amp; Limits</strong> — is informational only; there's
            nothing to edit here. Look at the three tiles.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Current Plan</strong> tile has a crown icon and a colored badge (e.g. Enterprise
            in amber). The <strong>Max Users</strong> and <strong>Max Contacts</strong> tiles show a
            large number; when there's no limit, an ∞ symbol appears instead of a number. Below them, the
            organization's <strong>Slug</strong> is shown in monospace.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The logo field doesn't upload an image — it only accepts the URL of an image that already
          exists. If your logo isn't online yet, host it somewhere first (for example, a file-storage
          service), then paste the direct link here. After pasting, the live preview confirms it points
          to the right image.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The plan, user limit and contact limit are <strong>not editable</strong> on this page — they
          are set by your organization's plan. To raise a limit or upgrade your tier, that's handled
          through the account/sales process; there is no button on the page.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          This page only shows and changes your own organization's data; you can't see another tenant's
          name, logo or plan. Once saved, name/logo changes apply to all users in your organization.
        </p>
      </HelpCallout>
    </div>
  )
}
