"use client"

/**
 * AI Actions / AI Advisor — help article (English).
 * Current /ai/actions section: operating center for AI signals, risk review,
 * Advisor questions, module coverage, and safe action approval.
 */
import {
  HelpCallout,
  HelpDef,
  HelpKey,
  HelpScenario,
  HelpSection,
  HelpStep,
} from "@/components/help/help-content"

export default function AiActionsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sales, support, finance, or operations lead"
        goal="Understand each day's risk, why it happened, and which AI action can safely move into approval"
      >
        Open the section through <HelpKey>AI</HelpKey> → <HelpKey>AI Advisor</HelpKey>. This is no
        longer only an approve/reject list: the page collects operational signals from CRM, sales,
        tasks, finance, tickets, routes, and KPIs, shows evidence, and proposes the next step. Actions
        do not run immediately; they first move into the approval queue.
      </HelpScenario>

      <HelpSection title="Section audit: what changed">
        <dl className="rounded-md border p-3">
          <HelpDef term="KPI strip">Shows open risks, critical signals, money at risk, pending actions, active modules, and execution failures.</HelpDef>
          <HelpDef term="Today">The main workspace: signal list on the left, selected risk and safe next step on the right.</HelpDef>
          <HelpDef term="Ask">Ready scenarios and a custom Advisor question. Answers stay grounded in the signals on this page.</HelpDef>
          <HelpDef term="Modules">Shows which sources are active, blocked by permissions, disabled, or failing collection.</HelpDef>
          <HelpDef term="Queue">Receives actions after <HelpKey>Queue action</HelpKey>. Review, edit payload fields, approve, or reject here.</HelpDef>
          <HelpDef term="History">Audit log of reviewed actions and execution status.</HelpDef>
        </dl>
        <HelpCallout kind="warning" label="Important">
          The old “approve all with 5-second undo” model is no longer the main flow. The current flow
          is signal → evidence → action preview → approval queue → execution and history.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Read the top summary">
        <HelpStep n={1}>
          <p>Start with <HelpKey>Open risks</HelpKey> and <HelpKey>Critical</HelpKey>.</p>
          <HelpCallout kind="see" label="What to look for">
            If critical count is high, start from the first item in <HelpKey>Needs attention</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Check <HelpKey>Money at risk</HelpKey> and <HelpKey>Pending actions</HelpKey>.</p>
          <HelpCallout kind="tip">
            Money at risk separates a routine stale item from a signal that can affect revenue, payment, or a contract.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>If <HelpKey>Failed executions</HelpKey> is non-zero, open <HelpKey>Queue</HelpKey> or <HelpKey>History</HelpKey>.</p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Main workflow: review a risk">
        <HelpStep n={1}>
          <p>
            On <HelpKey>Today</HelpKey>, filter the list by module, owner, or search text. For example:
            Sales, Finance, Tasks, Ticketing, or a specific company.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Click a signal on the left. <strong>Risk detail</strong> opens on the right.</p>
          <HelpCallout kind="see" label="Review">
            Risk title, idle age, amount, owner, facts, sources, and related signals.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In <HelpKey>Next step</HelpKey>, read what Advisor proposes: task, note, alert,
            follow-up draft, or record update.
          </p>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click <HelpKey>Queue action</HelpKey> only when the recommendation is correct. This is not
            a customer send; it moves the action into approval.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Use Ask">
        <p>
          <HelpKey>Ask</HelpKey> is for business questions rather than a single row: where money is at
          risk, which sales items are stalled, which tasks are overdue, or which SLA risks are open.
        </p>
        <HelpStep n={1}>
          <p>Choose a ready scenario such as <HelpKey>Sales risks</HelpKey> or <HelpKey>Money risk</HelpKey>.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Advisor filters signals, opens the primary risk, and answers with sources.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>From the answer, return to the risk or queue the primary next step.</p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Modules, queue, and history">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Modules</strong> explains Advisor coverage: whether a source is active, permission-blocked, or has no signals.</li>
          <li><strong>Approval Queue</strong> shows prepared actions with evidence and preview. Editable fields can be changed before approval.</li>
          <li><strong>History</strong> is the audit trail: who approved or rejected, whether execution completed, and where a failure happened.</li>
        </ul>
        <HelpCallout kind="security">
          Advisor is scoped to your organization. An AI suggestion does not become an external message, task, or record update until a user queues and approves it.
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
