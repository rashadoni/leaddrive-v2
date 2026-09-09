"use client"

/**
 * Board Configuration — help article (English).
 * Covers the board Configuration page (/boards/[divisionId]/settings):
 * task statuses (columns), task types, event types, task custom fields, and
 * default columns for the table view. Only admin/manager roles can open it;
 * writes are also server-gated.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function BoardSettingsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a board admin or manager"
        goal="Configure a board's columns, task and event types, custom fields, and table view"
      >
        You reach this page from the gear icon (<HelpKey>Configuration</HelpKey>) on the board's top
        toolbar. Only <strong>admin</strong>, <strong>superadmin</strong> and{" "}
        <strong>manager</strong> roles can open it — other roles are redirected back to the board itself.
        Everything you configure here is scoped to your organization (tenant).
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a gear icon next to <HelpKey>Configuration</HelpKey>, with a one-line
          subtitle ("Statuses, task types, event types, custom fields and table columns" for the current
          board key). Above it, a back arrow and the board name take you back to the board. The page has
          five sections, each its own card:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Task statuses">This board's columns — the flow a task moves through. Each column maps to one of the 6 canonical stages ("Counts as"). Scoped to this board only.</HelpDef>
          <HelpDef term="Task types">Functional categories for tasks (e.g. SEO, Social Media, departments). Shared across all boards.</HelpDef>
          <HelpDef term="Event types">The channel / source a task relates to (914 LINE, SOCIAL MEDIA…) — used for filtering. Shared across all boards.</HelpDef>
          <HelpDef term="Task custom fields">Extra fields on tasks (e.g. Brand, Channel). Shared across all boards; appear as columns in the table view.</HelpDef>
          <HelpDef term="Default columns">Which columns appear by default in the Tasks table view.</HelpDef>
          <HelpDef term="Counts as">The canonical status behind each column: Backlog, To Do, In Progress, Testing, Review, Done. Renaming a column doesn't change its underlying status.</HelpDef>
        </dl>
        <p>
          After each save a short toast appears top-right — green on success, red on error.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: edit task statuses (columns)">
        <HelpStep n={1}>
          <p>
            The <HelpKey>Task statuses</HelpKey> card lists the columns. Reorder a column with the
            up/down chevrons.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row, left to right: up/down arrows, a colored dot, the column name field, a "Counts as"
            dropdown, and a trash icon. On the first row the up arrow is dimmed; on the last row the down
            arrow is dimmed.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Rename a column directly in its text field (up to 40 characters). To set a color, click the
            colored dot and pick a swatch — or choose <HelpKey>Auto</HelpKey> to return to the default
            stage color.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A small palette opens under the dot: an "Auto" button on the left, then color swatches. Your
            choice applies to the dot immediately and the palette closes (Escape also closes it).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            From the <HelpKey>Counts as</HelpKey> dropdown on the right of each row, pick the canonical
            stage the column maps to: Backlog, To Do, In Progress, Testing, Review, Done.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown offers those six fixed options. This bridges the column's visible name and the
            underlying status — reports and automation work on the status.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To add a column, click the dashed <HelpKey>Add column</HelpKey> button below the list. To
            remove one, click the trash icon on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A new empty-named row is appended (default status "To Do"). At least 1 column must remain —
            the last column's delete icon is dimmed. The max is 12 columns; at the limit "Add column"
            becomes disabled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            When done, click <HelpKey>Save statuses</HelpKey> at the bottom-right of the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows a spinner, then a green "Statuses saved" toast appears top-right. If any
            column name is blank, the button stays disabled.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            A column's <strong>name</strong> is free-form, but its <HelpKey>Counts as</HelpKey> stage is
            load-bearing: reports, drag logic and automation all read the canonical status. Changing a
            column's underlying status changes the effective state of the tasks sitting in it.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: manage task types or event types">
        <HelpStep n={1}>
          <p>
            The <HelpKey>Task types</HelpKey> (or <HelpKey>Event types</HelpKey>) card lists the existing
            types. Both work the same way.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row: up/down arrows, a colored dot, a name field, a small grey machine name (monospace)
            on the right, an <HelpKey>Active</HelpKey>/<HelpKey>Inactive</HelpKey> toggle and a trash icon.
            If your org has no types yet, default rows (ids starting with "default-") are shown — they're
            read-only (dimmed) and get replaced when you add your first real type.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To add a type, type its name in the dashed row at the bottom of the card, optionally pick a
            color from the dot on the left, and click <HelpKey>Add</HelpKey> (or press Enter).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows a spinner while saving; on success the new type appears in the list and the
            input clears. On error, a red toast appears top-right.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To rename, edit the text field and click elsewhere (blur) — the change saves at that moment.
            To recolor, click the dot and pick a swatch.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Names are up to 60 characters. On blur the new name is sent to the server; leaving the field
            blank reverts to the previous name.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To retire a type, click its <HelpKey>Active</HelpKey> toggle — it becomes{" "}
            <HelpKey>Inactive</HelpKey> (click again to re-enable). To delete it entirely, click the trash
            icon.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An inactive row dims slightly. Deleting opens a "Delete {"{type}"}?" confirmation dialog; once
            confirmed the type leaves the list.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Task types answer <strong>what</strong> (a functional category — SEO, design…), event types
            answer <strong>where / which channel</strong> (914 LINE, SOCIAL MEDIA…). Both are shared
            across all boards — set them once here and they show up on every board.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: default columns for the table view">
        <HelpStep n={1}>
          <p>
            The <HelpKey>Default columns for table view</HelpKey> card has a live table preview on top
            and column chips below. Click a chip to show or hide that column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Visible chips carry a check (✓) and a highlighted background. The preview table reflects your
            selection instantly. The <HelpKey>Task</HelpKey> (name) column is always on — it shows
            "(always)" beside it and looks dimmed.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            A chip change applies to <strong>this browser only</strong>, immediately (stored locally). To
            make the selection the org-wide standard, click <HelpKey>Save as org default</HelpKey> below.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Toggling a chip flashes a small green "Saved" in the top-right of the card. If an org default
            already exists, the button reads "Update org default" and a "Remove org default" link appears
            next to it.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Only an admin or the creator can change the org default — if someone else tries, an "Only an
            admin or the creator can change the org default" warning appears. Removing the default falls
            members who haven't made a personal choice back to the lean default set.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: task custom fields">
        <HelpStep n={1}>
          <p>
            The <HelpKey>Task custom fields</HelpKey> card lists your org's existing custom fields as
            chips (e.g. Brand, Channel) — each chip shows the field label and its type.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If there are none, "No task custom fields yet." appears. Inactive fields look dimmed. If
            loading fails, an amber "Couldn't load custom fields." message shows.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To create and edit fields, click <HelpKey>Manage custom fields</HelpKey> below.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            It takes you to <HelpKey>/settings/custom-fields</HelpKey> — the full custom-field editor.
            This page only shows existing fields; the actual editing happens there.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          All configuration is scoped to your organization. The page is open only to admin/manager roles;
          other users are redirected back to the board. Even if you can see the controls, without write
          permission the server rejects the operation (403) — the gate applies both in the UI and on the
          backend.
        </p>
      </HelpCallout>
    </div>
  )
}
