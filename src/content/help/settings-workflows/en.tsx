"use client"

/**
 * Settings → Workflows — help article (English).
 *
 * Covers the two pages that make up no-code automation:
 * Workflows (/settings/workflows) — the rule list, the trigger form, and
 * the per-rule action editor — and Workflow Templates
 * (/settings/workflows/templates) — one-click pre-built automations.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SettingsWorkflowsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="What workflows do">
        <p>
          A <strong>workflow</strong> is an automation rule that watches one kind of record and,
          when something happens to it, runs one or more actions on your behalf — no code. The
          shape is always the same: <em>when</em> a <strong>trigger</strong> fires on an{" "}
          <strong>entity</strong> (and optional <strong>conditions</strong> match), <em>then</em> a
          list of <strong>actions</strong> runs in order.
        </p>
        <p>
          You build rules from scratch on the <strong>Workflows</strong> page, or apply a
          ready-made one in a click from <strong>Workflow Templates</strong> and tweak it later.
        </p>
      </HelpSection>

      <HelpSection title="The Workflows list">
        <p>
          The main page shows three counters — <HelpKey>Total</HelpKey>, <HelpKey>Active</HelpKey>,{" "}
          <HelpKey>Inactive</HelpKey> — above a card for every rule. Each card states the rule in
          plain language, e.g. <em>&quot;When Lead Created → Send email&quot;</em>, lists its action
          chips, and dims when the rule is inactive.
        </p>
        <HelpStep n={1}>
          <p>
            <HelpKey>Search workflows…</HelpKey> filters the list by rule name as you type. (It
            matches the name only, not triggers or actions.)
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On any card: <HelpKey>Actions</HelpKey> opens the action editor, the{" "}
            <HelpKey>pencil</HelpKey> edits the trigger and conditions, the{" "}
            <HelpKey>play / pause</HelpKey> button switches the rule on or off, and the{" "}
            <HelpKey>trash</HelpKey> icon deletes it.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Toggling pause is instant — a paused rule keeps its definition but stops firing. Only{" "}
            <strong>active</strong> rules ever run.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            First time here? A one-time banner points you at the templates gallery, and{" "}
            <HelpKey>Browse templates</HelpKey> (top-right) takes you there any time. Templates are
            the fastest way to a working rule.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Building a rule — the trigger">
        <p>
          <HelpKey>New workflow</HelpKey> (or the pencil on a card) opens the rule form. Here you
          set what the rule watches; actions come next, in a separate editor.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Name">A label for the rule — required.</HelpDef>
          <HelpDef term="Entity">deal, lead, ticket, task, contact, or company.</HelpDef>
          <HelpDef term="Trigger">
            created, updated, status&nbsp;changed, stage&nbsp;changed, assigned, or customer email
            reply.
          </HelpDef>
          <HelpDef term="Active">Whether the rule is live the moment you save it.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Optionally add <strong>conditions</strong> so the rule fires only on matching records.
            Each condition is a <em>field</em>, an <em>operator</em>, and a <em>value</em>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fields are status, stage, source, assignee, priority, and amount. Operators are{" "}
            <em>equals</em>, <em>not equals</em>, <em>contains</em>, <em>not empty</em>,{" "}
            <em>greater than</em>, and <em>less than</em> (<em>not empty</em> needs no value). Add
            several and they must <strong>all</strong> match.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            A rule with no conditions fires on every record of that entity for the chosen trigger —
            handy for a blanket &quot;welcome email on every new lead&quot;, but add a condition
            when you want to narrow it down.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Adding actions">
        <p>
          On a card, press <HelpKey>Actions</HelpKey> to open the flow editor. It draws the{" "}
          <strong>Trigger</strong> at the top and each action stacked beneath it in run order. Use{" "}
          <HelpKey>Add action</HelpKey> to append one, the pencil to edit, the trash to remove.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Send email">A template name and subject.</HelpDef>
          <HelpDef term="Create task">Title, description, priority, and an assignee (user ID).</HelpDef>
          <HelpDef term="Update field">A field name and the new value.</HelpDef>
          <HelpDef term="Send notification">An in-app message to your team.</HelpDef>
          <HelpDef term="Webhook">A URL and an HTTP method (GET / POST / PUT).</HelpDef>
          <HelpDef term="Auto assign">A user ID to assign the record to.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Build the list, reorder by adding in sequence, then <HelpKey>Save</HelpKey>. Actions run
            top to bottom whenever the trigger and conditions are met.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Saving the action editor <strong>replaces the whole action list</strong> for that rule
            in one go — it isn&apos;t a partial edit. Review the full stack before you save, and use{" "}
            <HelpKey>Cancel</HelpKey> to back out without changes.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Workflow Templates — start from a ready-made rule">
        <p>
          <HelpKey>Browse templates</HelpKey> opens a gallery grouped by category — the ones
          shipped today fall under <strong>Sales</strong>, <strong>Support</strong>, and{" "}
          <strong>Operations</strong> (only categories with at least one template appear). Each
          card shows its trigger as <code>entity.trigger</code> and how many actions it includes.
          Examples shipped today include a welcome email for new leads, round-robin lead
          assignment, a thank-you on a won deal, a new-ticket acknowledgement, and an SMS after a
          missed call.
        </p>
        <HelpStep n={1}>
          <p>
            Press <HelpKey>Preview &amp; apply</HelpKey> to open a preview. Safe fields — subject,
            body, message, title, and a <strong>delay in minutes</strong> (0–1440) — are editable
            inline before you commit.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Apply template</HelpKey> creates the rule and drops you back on the Workflows
            list, where you can refine it like any other.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            A delay of <strong>0</strong> runs the action immediately; a positive value waits that
            many minutes (the missed-call SMS template ships with a short delay so an agent can call
            back first).
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Apply a template you&apos;ve already used and you&apos;ll be warned it&apos;s a{" "}
            <strong>duplicate</strong>; an <HelpKey>Applied (N)</HelpKey> badge tracks the count. To
            proceed, tick the re-apply box — it deliberately creates a second copy. Templates that
            send SMS show an <HelpKey>SMS needed</HelpKey> badge and stay blocked until you connect
            a provider under <strong>Settings → VoIP</strong>.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="When and how rules run">
        <p>
          Rules fire on the matching CRM event — when a record is created, updated, assigned, and so
          on. The engine finds your <strong>active</strong> rules for that entity and trigger,
          checks the conditions, then runs each action in <strong>action order</strong>.
        </p>
        <HelpStep n={1}>
          <p>
            Most actions run on the spot. An action with a <strong>delay</strong> is queued instead
            and executed later by a background runner — retried up to three times if it fails.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            The <strong>SMS</strong> action (shipped via templates) fills{" "}
            <code>{"{{field}}"}</code> placeholders (e.g. <code>{"{{firstName}}"}</code>) from the
            record at send time. <strong>Send email</strong> and{" "}
            <strong>send notification</strong> send their text as written, so type a literal subject
            and body rather than relying on placeholders there.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Templates also include action types you won&apos;t see in the manual editor — such as{" "}
            <strong>SMS</strong> and <strong>Slack notification</strong>. Apply the template that
            uses them, then edit its other fields here.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Workflows are scoped to your organization — every rule, action, and template you apply
          belongs to your tenant only, and the server derives the organization from your session,
          never from a request header. For safety, <strong>Update field</strong> can only touch a
          fixed allow-list of fields per entity (it won&apos;t overwrite phone numbers, call
          recordings, or other system-managed values), and a <strong>Webhook</strong> action is
          blocked from calling private or internal network addresses.
        </p>
      </HelpCallout>
    </div>
  )
}
