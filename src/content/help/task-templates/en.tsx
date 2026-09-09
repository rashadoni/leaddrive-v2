"use client"

/**
 * Task Templates — help article (English).
 *
 * Covers Settings → Task Templates (/settings/task-templates): a CRUD
 * library of reusable task blueprints that pre-fill the New Task form.
 * Sources: settings/task-templates/page.tsx, /api/v1/task-templates
 * (+ [id] and [id]/instantiate), lib/task-templates/substitute.ts,
 * components/task-form.tsx, and the TaskTemplate Prisma model.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TaskTemplatesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="What a task template is">
        <p>
          A <strong>task template</strong> is a saved blueprint that pre-fills the New Task form.
          Instead of retyping the same status report, client-onboarding step, or weekly check-in
          every time, you save the shape once and stamp it out in two clicks.
        </p>
        <p>
          Templates live under <strong>Settings → Task Templates</strong>. Each one stores a task
          title, an optional description, a priority, an optional due-date offset, an optional
          linked record type, custom-field values, and a checklist — everything a fresh task needs
          to start half-finished.
        </p>
      </HelpSection>

      <HelpSection title="The library page">
        <p>
          The page shows your templates as cards, ordered by how often they&apos;ve been used (the
          most-used float to the top). Each card shows the template name, its task title, the
          priority, the due offset, and how many checklist items it carries.
        </p>
        <HelpStep n={1}>
          <p>
            Press <HelpKey>New template</HelpKey> (top-right, or the button in the empty state) to
            open the editor.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On a template you own, the pencil and trash icons appear on the card — edit or delete it
            there.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            A template another teammate <strong>shared</strong> shows a small globe icon, a{" "}
            <em>Shared by …</em> line, and its usage count. You can see and use it, but only the
            owner (or an admin) can edit or delete it.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Fields in the editor">
        <p>
          The editor splits into the template&apos;s own identity and the task fields it pre-fills.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Template name">Required. How the template shows in the picker — e.g. &ldquo;Weekly status report&rdquo;.</HelpDef>
          <HelpDef term="Description">Optional note on when to use it; shown in the picker dropdown.</HelpDef>
          <HelpDef term="Task title">Required. The title the new task gets — supports the variables below.</HelpDef>
          <HelpDef term="Task description">Optional body text copied onto the task.</HelpDef>
          <HelpDef term="Priority">low, medium, high, or urgent.</HelpDef>
          <HelpDef term="Due in (days)">Days from creation. The new task&apos;s due date becomes today + this many days. Leave empty to start with no due date. Range 0–3650.</HelpDef>
          <HelpDef term="Link to entity">Optionally pre-set the related record type: company, contact, deal, lead, or ticket. You pick the specific record when you create the task.</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            Empty fields are intentional — a blank field means &ldquo;leave the New Task form&apos;s
            own default&rdquo; rather than forcing a value. Only fill what you want every instance to
            inherit.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Variables in the task title and description">
        <p>
          Put a placeholder in the task title or description and it&apos;s replaced with a live value
          the moment you create the task:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term={"{{date}}"}>Today&apos;s date in your locale format.</HelpDef>
          <HelpDef term={"{{user}}"}>The name of the person creating the task.</HelpDef>
          <HelpDef term={"{{month}}"}>The current month name, e.g. &ldquo;May&rdquo;.</HelpDef>
          <HelpDef term={"{{week}}"}>The ISO week number, e.g. &ldquo;22&rdquo;.</HelpDef>
        </dl>
        <p>
          So a title like <HelpKey>{"Status report — {{date}}"}</HelpKey> becomes{" "}
          <em>Status report — 28.05.2026</em> on the day it&apos;s used. An unrecognized placeholder
          is left untouched, so a typo stays visible in the task instead of vanishing.
        </p>
      </HelpSection>

      <HelpSection title="The checklist">
        <p>
          Below the task fields you can build a <strong>checklist</strong> — the sub-steps every task
          from this template should carry.
        </p>
        <HelpStep n={1}>
          <p>
            Press <HelpKey>Add item</HelpKey> and type what needs doing. Add as many as you like.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Reorder items with the up / down arrows on each row, or remove one with the{" "}
            <HelpKey>×</HelpKey> button.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            When the template is used, these items are copied onto the new task as fresh, all-unchecked
            checklist entries in the order you set.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Sharing &amp; saving">
        <p>
          The <HelpKey>Share with the whole team</HelpKey> checkbox controls visibility. Unchecked, a
          template is private to you. Checked, everyone in your organization can see and use it (the
          globe icon marks shared ones).
        </p>
        <HelpStep n={1}>
          <p>
            Fill at least the <strong>template name</strong> and the <strong>task title</strong> —
            both are required; saving without them shows an error.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Press <HelpKey>Save</HelpKey>. Editing an existing template updates it in place; the
            change is visible to everyone who can see that template.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            To actually use a template, open <strong>Tasks → New Task</strong>: when at least one
            template is available you&apos;ll see a <HelpKey>From template…</HelpKey> picker. Choose
            one and the form fills itself in — title (variables resolved), description, priority, due
            date, assignee, linked type, custom fields, and the checklist. Tweak anything before you
            save.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Usage count">
        <p>
          Every time a template is picked in the New Task form, its <strong>usage count</strong> ticks
          up by one. That counter is what sorts the library — your team&apos;s go-to templates rise to
          the top on their own, with no manual ordering. Using a shared template credits the template
          itself, not just its owner.
        </p>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Templates are scoped to your organization and gated by the same task permissions used
          across the CRM — you only see your own templates plus the ones shared in your tenant.
          Editing and deleting are limited to the <strong>owner</strong> or an{" "}
          <strong>admin / superadmin</strong>, so a teammate can&apos;t alter your template and an
          admin can still tidy up after someone who has left. Create, update, and delete are written
          to the audit log; deletion is permanent (there&apos;s no trash).
        </p>
      </HelpCallout>
    </div>
  )
}
