"use client"

/**
 * Contract Intake Forms — help article (English).
 * Covers only Settings → Contract Intake Forms (creating a form, questions,
 * mapping answers to contract fields, default approval stages, active/inactive
 * state, deactivation). Create/edit/deactivate controls are admin-only.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function IntakeFormsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an administrator or operations manager"
        goal="Set up a form users fill to request a contract — with questions, mapping to contract fields, and default approval stages"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Contract Intake Forms</HelpKey>.
        All forms are scoped to your organization. The buttons to create, edit and deactivate forms
        appear only for the <strong>admin</strong> and <strong>superadmin</strong> roles — other roles
        can read the list but won't see the editing controls.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a back arrow, then a form icon next to the{" "}
          <HelpKey>Contract Intake Forms</HelpKey> title, with the line "Configure intake forms that
          users fill to request a contract" beneath it. If you're an admin, a{" "}
          <HelpKey>New Form</HelpKey> button sits at the top-right. Below that, existing forms are laid
          out as cards in a two-column grid — if there are none yet, an empty-state card shows instead.
          A red banner appears at the top if loading or saving fails.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Form (intake form)">A set of questions users fill to request a contract. Each submission auto-creates a contract draft.</HelpDef>
          <HelpDef term="Question">One input field on the form — it has a label, a type, and a required toggle.</HelpDef>
          <HelpDef term="Map to contract field">A mapping that copies the answer straight into a contract field (title, value amount, currency, notes, type).</HelpDef>
          <HelpDef term="Default contract type">The type pre-set on contracts created from this form (service agreement, NDA, maintenance, license, SLA, other).</HelpDef>
          <HelpDef term="Default approval stages">An ordered list of approval steps the submitted contract is auto-routed through — each has a label, an assignee role, and SLA hours.</HelpDef>
          <HelpDef term="Submission">A filled-in, submitted form; the card shows how many submissions this form has received.</HelpDef>
          <HelpDef term="Inactive">A deactivated form — it no longer accepts new submissions, but existing submissions are preserved.</HelpDef>
        </dl>
        <p>
          Each form card shows the name, an <strong>Inactive</strong> badge (when applicable) and a
          contract-type badge, an optional one-line description, and a{" "}
          <strong>"N questions · M submissions"</strong> summary. If you're an admin, the right side has
          a pencil edit button and — only while the form is active — a red trash deactivate button. An
          inactive card is rendered slightly dimmed.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new form">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New Form</HelpKey> at the top-right. (If there are no forms yet, the{" "}
            <HelpKey>Create your first form</HelpKey> button in the empty state opens the same dialog.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A wide "New Form" dialog opens. At the top are the basics:{" "}
            <strong>Form name *</strong>, <strong>Description (optional)</strong>, a{" "}
            <strong>Default contract type</strong> dropdown, and an <strong>Active</strong> toggle (on
            by default). Below come the "Questions" and "Default approval stages" sections.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Form name</strong> — it's the only required field (e.g. "Services Agreement
            Request"). Optionally add a short <strong>Description</strong> and pick a{" "}
            <strong>Default contract type</strong> (leave it on "Any type" to set none).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Text appears in the fields as you type. While the name is empty, the <HelpKey>Save</HelpKey>{" "}
            button at the bottom stays disabled. The type dropdown offers <em>Any type</em> plus the
            standard types (service_agreement, nda, maintenance, license, sla, other).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the <strong>Questions</strong> section click <HelpKey>Add question</HelpKey>. For each
            question, type a <strong>Question label *</strong>, choose a <strong>Type</strong> (text,
            textarea, number, date, select), optionally set <strong>Map to contract field</strong>, and
            flip the <strong>Required</strong> toggle when needed.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each question appears as its own card — a drag handle on the left, a label input, two
            dropdowns plus a <strong>Required</strong> toggle, and a red trash icon on the right that
            removes the question. If you set the type to <em>select</em>, an extra{" "}
            <strong>Options (comma-separated)</strong> field appears. With no questions you see "No
            questions yet."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally add <strong>Default approval stages</strong>: click{" "}
            <HelpKey>Add stage</HelpKey>, then for each row type the stage label, pick the assignee role
            (admin / manager / member), and enter <strong>SLA hours</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The section starts with the hint "Optional. If set, the submitted contract is auto-routed
            through these stages." Each stage is added as a numbered row (1., 2., …): a label input, a
            role dropdown, an SLA-hours field (numbers only), and a remove icon.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Save</HelpKey> at the bottom. (Changed your mind? Close it with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While saving, a spinner shows on the button. On success the dialog closes and the new form
            appears in the list (starting at "0 questions · 0 submissions", or the question count you
            entered). On error the dialog stays open and a red banner appears at the top.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit a form">
        <HelpStep n={1}>
          <p>
            On the card of the form you want to change, click the pencil button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same dialog opens titled "Edit Form", pre-filled with the current name, description,
            contract type, status, questions and stages.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Change the fields you need — add or remove questions, reorder the drag-handled cards — then
            confirm with <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After the changes are saved the dialog closes and the card's name, badges, and the
            "questions · submissions" summary update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: deactivate a form">
        <HelpStep n={1}>
          <p>
            On an active form's card, click the red trash button. (This button shows only while the form
            is active.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirmation dialog appears: "Deactivate this form? Existing submissions are
            preserved."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form gets an <strong>Inactive</strong> badge, its card dims slightly, and the trash
            button disappears (you can't deactivate it from the card again). The submission count stays
            unchanged.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Mapping a question to a contract field is the key move: with{" "}
          <HelpKey>Map to contract field</HelpKey> the answer flows straight into a contract field
          (title, value amount, currency, notes, type). That way, when the form is submitted, the draft
          is filled automatically — no need to re-type. If you don't need a mapping, leave it on "No
          mapping" and the answer is stored as a plain form response.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The trash button on the card <strong>deactivates</strong> the form, it does not delete it —{" "}
          existing submissions are kept, the form simply stops accepting new requests. For questions of
          type <em>select</em>, remember to fill in the <strong>Options</strong> field, otherwise the
          user has no choices to pick from.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Only <strong>admin</strong> and <strong>superadmin</strong> can create, edit and deactivate
          forms — for other roles these buttons aren't rendered at all. All forms are scoped to your
          organization; you can't see another organization's forms.
        </p>
      </HelpCallout>
    </div>
  )
}
