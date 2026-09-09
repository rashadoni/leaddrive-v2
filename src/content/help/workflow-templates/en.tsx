"use client"

/**
 * Workflow Templates — help article (English).
 * Covers only Settings → Workflows → Templates: the gallery of ready-made
 * automation templates, category grouping, the preview/customize modal,
 * and applying a template. Building an automation from scratch is NOT
 * covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function workflowtemplatesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an operations admin or team lead"
        goal="Start from a ready-made automation instead of building a rule from scratch, customize its wording, and apply it"
      >
        You reach this page from <HelpKey>Settings</HelpKey> → <HelpKey>Workflows</HelpKey>, then{" "}
        <HelpKey>Templates</HelpKey>. You don't create anything here — you browse ready-made automations,
        pick one, tweak its text, and apply it. After you apply, the system takes you to your workflows
        list. All templates and the rules they create belong only to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left there's a <HelpKey>Back to workflows</HelpKey> link, and below it the page title{" "}
          <strong>Workflow Templates</strong> (with a violet Sparkles icon) and the line «Start from a
          ready-made automation and customize later». If your organization has no SMS provider configured,
          an amber banner appears under the title with a <HelpKey>Configure now →</HelpKey> link.
        </p>
        <p>
          The main area is the template gallery: templates are grouped by category (
          <strong>Sales</strong>, <strong>Support</strong>, <strong>Marketing</strong>,{" "}
          <strong>Operations</strong>), each group has a small uppercase heading, and the cards sit in a
          three-column grid below it. While templates load you'll see grey «pulse» placeholder cards; if
          there are none, the page shows «No templates available».
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Template">A ready-made automation scenario — one trigger plus a few actions — that becomes a real rule when you apply it.</HelpDef>
          <HelpDef term="Category">The area a template belongs to: Sales, Support, Marketing or Operations.</HelpDef>
          <HelpDef term="Trigger">The event that fires the rule — shown on the card as a monospace «entity.event» tag (e.g. lead.created).</HelpDef>
          <HelpDef term="Action">A step run when the trigger fires (send email, create task, send SMS, …); the card shows how many there are.</HelpDef>
          <HelpDef term="SMS needed">If a template sends SMS, an amber «SMS needed» badge shows on the card until a provider is configured.</HelpDef>
          <HelpDef term="Applied">If you've already applied a template, a green «Applied (count)» badge appears in the card's top-right corner.</HelpDef>
        </dl>
        <p>
          Each card shows an icon on the left, the template name, a category badge, a short description, a
          monospace trigger tag with an «N actions» indicator below it, and a full-width button at the
          very bottom. That button reads <HelpKey>Preview &amp; apply</HelpKey> if the template hasn't been
          applied yet, or <HelpKey>Preview again</HelpKey> if it already has.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: preview and customize a template">
        <HelpStep n={1}>
          <p>
            On the template card you like, click the <HelpKey>Preview &amp; apply</HelpKey> button at the
            bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A large modal opens, headed by the template's name and description. Up top, inside a grey box,
            is a <strong>Trigger</strong> field with the trigger shown as monospace code (e.g.
            lead.created).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Under the heading <strong>Actions (edit below to customize)</strong>, review each step of the
            template — each sits in its own bordered block with the action type (e.g.{" "}
            <HelpKey>send_email</HelpKey>) and its number (#1, #2…) at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each action block shows only the fields relevant to that action:{" "}
            <strong>Subject</strong>, <strong>Body</strong>, <strong>Message</strong>,{" "}
            <strong>Title</strong>, and/or <strong>Delay (minutes)</strong>. The fields come
            pre-filled with the template's default values.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Edit any text you want — for example, adapt a welcome email's <strong>Subject</strong> and{" "}
            <strong>Body</strong> to your company. To delay a step, enter a number from 0 to 1440 in the{" "}
            <strong>Delay (minutes)</strong> field.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Your edits appear in the field as you type. Below the delay field is the hint «0 = run
            immediately. The CRM waits this many minutes before executing the action.» If you leave it
            blank or enter an invalid number, the value falls back to 0.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: apply the template">
        <HelpStep n={1}>
          <p>
            At the bottom-right of the modal, click <HelpKey>Apply template</HelpKey>. (Changed your mind?
            Use <HelpKey>Cancel</HelpKey> on the left to close it.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Applying...» while it works. On success a «Template applied. Opening
            workflow...» toast appears, the modal closes, and the system redirects you to your{" "}
            <HelpKey>Workflows</HelpKey> list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If you've applied this template before, its card button reads <HelpKey>Preview again</HelpKey>,
            and inside the modal an amber checkbox appears: «I understand — re-apply anyway. This will
            create a duplicate rule.»
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Until you tick that box, the <strong>Apply template</strong> button stays disabled. Ticking it
            enables the button. If you try to apply without ticking it, you get a «This template is
            already applied…» warning.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            For an SMS-sending template with no provider configured, the modal shows an amber block: «This
            template sends SMS. Configure Twilio or Vonage in Settings → VoIP first.»
          </p>
          <HelpCallout kind="see" label="What you'll see">
            In that case the <strong>Apply template</strong> button stays disabled. If you try to apply
            without configuring an SMS provider, you get an error toast with the same message.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          An applied template never disappears — it's simply added to your <HelpKey>Workflows</HelpKey>{" "}
          list as a new automation rule. You can edit, pause, or delete that rule there afterwards, so you
          don't have to get every word perfect before applying.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Re-applying the same template creates a <strong>second, duplicate rule</strong> — it does not
          replace the old one. So before you «Preview again» and re-apply, make sure you really want a
          second rule; otherwise the same event could fire two emails/SMS.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All templates and the rules they create are scoped to your organization — you can't see or
          affect another organization's rules. SMS-sending templates use only your own tenant's VoIP
          configuration (Twilio/Vonage).
        </p>
      </HelpCallout>
    </div>
  )
}
