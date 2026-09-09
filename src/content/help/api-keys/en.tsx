"use client"

/**
 * API Keys — help article (English).
 * Covers Settings → API Keys: creating a key, choosing scopes,
 * setting an expiry, the one-time raw-key reveal, and revoking a key.
 * Security emphasis — the raw key is shown only ONCE.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function apikeysHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an admin or the technical owner of an integration"
        goal="Create a key so an external system can call the LeadDrive API programmatically, grant it the right scopes, and revoke it when needed"
      >
        Reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>API Keys</HelpKey>. All keys belong
        to your organization only. <strong>Creating and revoking keys is limited to admin (or superadmin)
        users</strong> — other roles can see the list, but the <HelpKey>Create Key</HelpKey> button and
        the trash button are hidden from them.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The heading shows a key icon with the <HelpKey>API Keys</HelpKey> title and a subtitle about
          programmatic access to the LeadDrive API. Top-right (admins only) is the{" "}
          <HelpKey>Create Key</HelpKey> button. Below it comes the list of existing keys — if there are
          none yet, an empty state with a key icon is shown instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Name">An internal label to recognize the integration (e.g. "Production integration"). Not the key itself.</HelpDef>
          <HelpDef term="Key prefix">Only the first few characters of the key, shown as code (e.g. ld_… form, ending in "…"). The full key isn't stored, so only the prefix appears in the list.</HelpDef>
          <HelpDef term="Active / revoked">The key's state — a green "Active" badge or a red "revoked" badge.</HelpDef>
          <HelpDef term="Scope">A permission that defines what the key may do via the API. The card shows the scope count with a shield icon, and the names of the first six scopes below.</HelpDef>
          <HelpDef term="Last used / Expires / Created">When the key was last used, when it expires (if set, with a clock icon), and when it was created.</HelpDef>
        </dl>
        <p>
          Each key card has a key icon on the left, the name + prefix code + state badge in the middle,
          the scope count and dates underneath, and below that small chips of the scope names (truncated
          as "+N" if there are more than six). On the right — admins only — a red trash button revokes the
          key.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new API key">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Create Key</HelpKey> at the top-right. (If there are no keys yet, the{" "}
            <HelpKey>Create First Key</HelpKey> button in the empty state does the same thing.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "New API Key" dialog opens. It contains a <strong>Name</strong> field, an{" "}
            <strong>Expiry</strong> dropdown, and an <strong>Access permissions (scopes)</strong> checkbox
            list. <HelpKey>Cancel</HelpKey> and <HelpKey>Create</HelpKey> buttons sit at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Enter a <strong>Name</strong> — this is an internal label to tell keys apart (e.g. "Production
            integration"). A hint under the field reads "Internal name — to distinguish keys for different
            integrations."
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text appears in the field. While empty, the placeholder "e.g. Production integration" shows
            faintly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally choose an <strong>Expiry</strong>: <HelpKey>Never expires</HelpKey>,{" "}
            <HelpKey>30 days</HelpKey>, <HelpKey>90 days</HelpKey>, or <HelpKey>1 year</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown offers four options. <strong>Never expires</strong> is selected by default — the
            key works until you revoke it. If you pick a duration, the key card will later show an "Expires"
            date with a clock icon.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            In <strong>Access permissions (scopes)</strong>, check the permissions you want to grant. Each
            scope sits on its own row as a checkbox; some show a short description underneath.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The scopes are listed by code name in a scrollable box. Above it is the hint "Only select what
            the integration actually needs — principle of least privilege." If scopes are still loading,
            "Loading scopes…" is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Click{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the name is empty or no scope is selected, a red "Name and at least one scope are required."
            warning appears inside the dialog and nothing is created. Otherwise the button changes to
            "Loading..." while it's being created, then the create dialog closes and a key-created dialog
            opens.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: copy and store the raw key once">
        <HelpStep n={1}>
          <p>
            When the key is created successfully, a "Key Created" dialog opens with a green check icon. This
            is where the full (raw) key is shown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            At the top is an amber warning box: "Copy the key now — after closing this window it will not
            be shown again. Store it in a safe place (e.g. a password manager)." Below it is the key's name,
            then under "API Key" the full key appears in a read-only text field.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the copy button next to the key to put it on your clipboard, then immediately paste it
            somewhere safe — a password manager or your integration's secret settings.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On a successful copy, the button's icon briefly (about 2 seconds) turns into a green checkmark,
            then reverts to the normal copy icon.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            The dialog also gives a ready <strong>Usage example</strong> — a curl command showing how to
            use the key. When you're done storing it, click <HelpKey>Done</HelpKey> at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The "Usage example" section shows a sample command with an <code>Authorization: Bearer …</code>{" "}
            header. Clicking <HelpKey>Done</HelpKey> closes the dialog and the new key appears in the list.
            The list shows only the key's prefix (e.g. ld_…) — the full key is never shown again.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: revoke a key">
        <HelpStep n={1}>
          <p>
            On the card of the key you want to revoke, click the red trash button on the right (this button
            is visible to admins only).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirmation prompt appears: "Revoke key "&lt;key name&gt;"? Integrations using this
            key will stop working."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm to revoke the key. Changed your mind? Cancel the prompt — nothing changes.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After confirming, the list refreshes. While the deletion runs, that card's button is briefly
            disabled. The key now rejects every API request made with it.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Revoking a key takes effect <strong>immediately and can't be undone</strong> — every
            integration using that key stops working. If you need a replacement, create the new key and
            wire it into the integration first, and only then revoke the old one so there's no downtime.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Follow the principle of least privilege: grant a key only the scopes the integration truly needs.
          Create a separate, distinctly named key per integration — that way, if one leaks you can revoke
          just that one and leave the rest untouched.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The raw key is shown <strong>only once</strong> — at creation — and is not stored in cleartext;
          only the prefix remains in the list. Be sure to copy it before closing the dialog. Never put a
          key in code, a repository, or shared messages — keep it in a password manager or environment
          variables. Keys are organization-scoped: creating/revoking requires admin rights, and you cannot
          see another organization's keys. If you suspect a key is exposed, revoke it immediately.
        </p>
      </HelpCallout>
    </div>
  )
}
