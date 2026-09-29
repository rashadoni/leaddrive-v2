"use client"

import {
  HelpCallout,
  HelpDef,
  HelpKey,
  HelpSection,
  HelpStep,
} from "@/components/help/help-content"

export default function AiAssistantHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Open Da Vinci and ask one focused question">
        <p>
          Da Vinci helps you inspect CRM data, analyze a situation, find supported records, and
          prepare supported actions. Its availability depends on your organization settings,
          enabled modules, and permissions.
        </p>
        <HelpStep n={1}>
          <p>
            Use the Da Vinci field on the Dashboard or an available <HelpKey>Ask Da Vinci</HelpKey>
            action. Type a question and press <HelpKey>Enter</HelpKey>; use <HelpKey>Shift + Enter</HelpKey>
            for a new line.
          </p>
          <HelpCallout kind="see">
            The assistant opens on the right and starts a conversation without leaving your CRM
            screen.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Name the object, scope, and outcome you need. Add a period for questions about past
            activity: for example, “Show deals lost this month by owner.”
          </p>
          <HelpCallout kind="see">
            A precise request produces a more useful summary, verified result, or follow-up
            question when a required detail is missing.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          Ask reporting and how-to questions separately. This lets Da Vinci verify the requested
          CRM data instead of mixing instructions with a numeric report.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Read the answer and its result state">
        <dl className="rounded-md border p-3">
          <HelpDef term="Answer">A concise explanation or analysis based on the available context.</HelpDef>
          <HelpDef term="Results">A read-only table may appear for supported CRM searches. Open a row or the full list to continue in the CRM.</HelpDef>
          <HelpDef term="Could not verify">Da Vinci did not obtain dependable CRM evidence. Refine the object, filters, or period instead of treating an estimate as fact.</HelpDef>
          <HelpDef term="Unavailable">The capability, module, configuration, or permission is not active for this request.</HelpDef>
        </dl>
        <p>
          The panel can use the current page and recent conversation as context. Select the expand
          control when a table or long answer needs more room.
        </p>
      </HelpSection>

      <HelpSection title="Review actions before they change CRM data">
        <HelpStep n={1}>
          <p>Read the action card and its status below the answer.</p>
          <HelpCallout kind="see">
            Read-only results are navigation aids. Supported low-risk actions can complete
            immediately; higher-risk actions display <HelpKey>Awaiting approval</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Before selecting <HelpKey>Approve</HelpKey>, verify the action type, recipient, record,
            and fields shown. Select <HelpKey>Reject</HelpKey> if anything is wrong or unclear.
          </p>
          <HelpCallout kind="see">
            An approved action runs once and reports Done or Failed. A rejected action is not
            executed.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          AI output can be incomplete or wrong. Verify customer-facing messages, financial facts,
          legal commitments, record changes, and other business-critical decisions before acting.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Control the conversation">
        <dl className="rounded-md border p-3">
          <HelpDef term="?">Open this guide.</HelpDef>
          <HelpDef term="Expand">Widen the panel for long answers and result tables.</HelpDef>
          <HelpDef term="Clear">Remove the visible conversation from the panel. It does not delete CRM records.</HelpDef>
          <HelpDef term="Close">Hide the panel. You can also press Escape when no guide is open.</HelpDef>
        </dl>
      </HelpSection>

      <HelpCallout kind="security">
        Da Vinci is scoped to your organization and permissions, but you should still avoid
        entering passwords, access tokens, payment-card data, or unrelated confidential material.
        If the assistant says it is not configured or you lack access, ask your administrator to
        check AI settings and your role.
      </HelpCallout>
    </div>
  )
}
