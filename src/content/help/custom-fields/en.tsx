"use client"

/**
 * Custom Fields — help article (English).
 * Covers only Settings → Custom Fields: creating, editing, deleting
 * fields, filtering by entity, and the admin-only access limit. How
 * field values are filled in on object forms (Contact/Deal forms) is
 * NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CustomFieldsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an admin or superadmin"
        goal="Add your own custom fields to the CRM's standard objects (Contact, Deal, Lead, Company) so the data your team captures fits your business"
      >
        Reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Custom Fields</HelpKey>. All fields
        belong to your organization only. <strong>Creating, editing and deleting</strong> fields is
        restricted to the admin and superadmin roles — other roles can open the page but only view the
        existing fields without changing them. Everything you see is read from the same live list, so
        groups update immediately as you add or delete a field.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The heading shows <HelpKey>Custom Fields</HelpKey> (with a sparkles icon) and the line
          «Extend Companies, Contacts, Deals and Leads with your own fields.» below it. If you're an
          admin, an <HelpKey>Add field</HelpKey> button sits top-right; if you're not, an amber «Only
          admins can manage custom fields» banner appears instead. Below is a{" "}
          <HelpKey>Filter by entity</HelpKey> dropdown. Fields are grouped by entity type — each group
          header has its icon, name, and a count in parentheses.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Custom field">A field you add to a standard form — with a name, display label, type, whether it's required, and a default value.</HelpDef>
          <HelpDef term="Field name">The system's internal key (e.g. custom_source) — shown as code; workflow conditions reference the field by this name.</HelpDef>
          <HelpDef term="Display label">The label shown to users on forms (e.g. «Lead Source»).</HelpDef>
          <HelpDef term="Entity type">Which object the field attaches to: Contact, Deal, Lead, Company (the page may also show a Tasks group).</HelpDef>
          <HelpDef term="Field type">The field's type: Text, Number, Date, Dropdown, Yes/No, or Long text.</HelpDef>
          <HelpDef term="Required">A red «Required» badge — the object can't be saved without this field filled in.</HelpDef>
          <HelpDef term="Inactive">A grey «Inactive» badge — the field still exists but isn't used actively on forms.</HelpDef>
        </dl>
        <p>
          Each field row shows, left to right: the <strong>display label</strong>, the{" "}
          <strong>field name</strong> in a monospace code chip, a field-type badge, and (when
          applicable) red <strong>Required</strong> and grey <strong>Inactive</strong> badges. If the
          field type is «Dropdown», the first eight options appear below as small chips (the rest are
          collapsed into «+N»). If a default value is set, it shows on its own line. For admins, two
          buttons sit on the right: <strong>edit</strong> (pencil icon) and <strong>delete</strong>{" "}
          (red trash-can icon).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a custom field">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Add field</HelpKey> button at top-right. (If there are no fields yet,
            the matching button in the middle of the empty state works too.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «New custom field» dialog opens. It has <strong>Field name *</strong> and{" "}
            <strong>Display label *</strong> in two columns, then <strong>Entity type</strong> and{" "}
            <strong>Field type</strong> dropdowns, then a <strong>Default value</strong> field and a{" "}
            <strong>Required field</strong> checkbox.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Field name</strong> — the system's internal key (e.g.{" "}
            <HelpKey>custom_source</HelpKey>). Then type a <strong>Display label</strong> — the label
            shown on forms (e.g. «Lead Source»). Both are required.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The fields show example placeholders: <HelpKey>custom_source</HelpKey> on the left and{" "}
            <HelpKey>Lead Source</HelpKey> on the right. If either is left empty, the browser won't let
            you submit the form (the field is marked as required).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick an <strong>Entity type</strong>: Contact, Deal, Lead, or Company (Contact is selected
            by default). Then pick a <strong>Field type</strong>: Text, Number, Date, Dropdown, Yes/No,
            or Long text.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As soon as you choose «Dropdown» for <strong>Field type</strong>, a new{" "}
            <strong>Options (comma separated)</strong> text box appears below (placeholder: «Option 1,
            Option 2, Option 3»). For other types this box isn't shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally type a <strong>Default value</strong>, and tick the{" "}
            <HelpKey>Required field</HelpKey> checkbox if the field must always be filled in.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The checkbox switches to its ticked state. (This will show up on the field's row in the
            list as a red «Required» badge.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Close it with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Saving...» while it saves, then the dialog closes and the new field
            appears under its entity group, with that group header's count incremented by one. If
            saving fails, a red error message shows at the top of the dialog and it stays open.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete a field">
        <HelpStep n={1}>
          <p>
            To change a field, click the pencil-icon (<HelpKey>Edit</HelpKey>) button on the right of
            its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens, titled «Edit custom field», pre-filled with the current values. Make
            your changes and confirm with the <HelpKey>Update</HelpKey> button at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete a field, click the red trash-can-icon (<HelpKey>Delete</HelpKey>) button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirmation appears: «Delete field "&lt;name&gt;"? All stored values will be
            removed permanently.» After you confirm with <HelpKey>OK</HelpKey>, the trash button is
            briefly disabled while it deletes, then the field disappears from the list and the group
            count updates.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion can't be undone and{" "}
            <strong>permanently removes every stored value for that field</strong> across all objects.
            If you only want to take a field out of use temporarily, it's safer to edit it and set it
            inactive instead — the field and its values stay, they're just not used actively on forms.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: filter by entity">
        <HelpStep n={1}>
          <p>
            To see only one object's fields, pick an entity in the{" "}
            <HelpKey>Filter by entity</HelpKey> dropdown (e.g. Deal).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list shows only the selected entity's group; the other groups are hidden. To go back to
            everything, pick <HelpKey>All entities</HelpKey> from the dropdown.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Don't confuse <strong>Field name</strong> with <strong>Display label</strong>. The field
          name is the system's internal key and is referenced by that name in workflow conditions — a
          short, lowercase, underscored value (e.g. <HelpKey>custom_source</HelpKey>) is easiest. The
          display label is the label your team sees on forms, and can be in any language, with spaces.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All custom fields are scoped to your organization — you never see other organizations'
          fields. Creating, editing and deleting fields is open only to the{" "}
          <strong>admin</strong> and <strong>superadmin</strong> roles; other roles see this page
          read-only (an amber banner appears at the top, and the add / edit / delete buttons are
          hidden).
        </p>
      </HelpCallout>
    </div>
  )
}
