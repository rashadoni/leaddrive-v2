# Da Vinci Operations Advisor — Video Script

## Goal

Before showing the UI, explain what the Advisor section means.

The viewer should understand that `/ai/actions` is not a chatbot and not a normal report. It is an operations control center that turns CRM data into a controlled execution loop:

`data -> signal -> evidence -> why it matters -> safe next step -> approval -> execution -> audit -> playbook learning`

Presenter rule: do not start with clicks. First explain the business meaning of the section, then explain the full 100% cycle, and only after that show how the live product works.

## Opening Script RU

Before any screen walkthrough, say this section first:

LeadDrive already has many modules: CRM, sales, contracts, marketing, tasks, finance, support, routes, field work, visit evidence and manager KPIs. The problem is not that the data is missing. The problem is that a manager should not spend the morning opening every module just to understand where the business is losing time, money or control.

Da Vinci Operations Advisor is the section that turns this data into an operating cycle. It finds delays, overdue work, stale deals, contract blockers, unpaid invoices, SLA risks, route problems and KPI gaps. But the important part is not just "AI found something". The important part is that every recommendation must have proof and a safe next step.

The full cycle is:

`data -> signal -> evidence -> why it matters -> safe next step -> approval -> execution -> audit -> playbook learning`

That means: the system reads permitted data, detects a real signal, shows the evidence, explains why it matters, prepares the next safe action, asks for approval, executes only after approval, keeps an audit trail, and later can turn repeated approved patterns into controlled playbooks.

So this is not a chatbot and not a decorative dashboard. This is an operations center. Advisor recommends. Manager approves. Execution is audited.

Only after this explanation, start showing `/ai/actions`.

## Opening Narration

LeadDrive already stores the daily work of the business: customers, leads, deals, offers, contracts, invoices, tasks, support tickets, routes, field visits, visit photos and manager KPIs.

The problem is not only storing this data. The real problem is knowing what needs attention today.

Usually, a manager has to open many modules manually:

- which deal is stuck;
- which invoice is overdue;
- which contract blocks payment;
- which task is late;
- which route was not completed;
- which support ticket is close to SLA breach;
- which manager is falling behind the monthly plan.

Da Vinci Operations Advisor is built to watch these operational signals across the CRM and show the next safe step.

It does not start as an uncontrolled autopilot. The safe model is:

> Advisor detects, explains and prepares. The manager approves. Execution is audited.

## Explain the 100% Cycle

The full Advisor cycle is:

1. **Data**
   LeadDrive reads permitted CRM data from modules such as sales, contracts, finance, tasks, support, routes and MTM.

2. **Signal**
   The system detects a real operational exception: overdue invoice, stale deal, unsigned contract, missed route stop, SLA risk, aging task or KPI gap.

3. **Evidence**
   Every signal must show source records. The manager can click back to the real deal, invoice, contract, ticket, route, visit or visit photo.

4. **Why it matters**
   Advisor explains the business impact in one sentence: money at risk, SLA breach, lost sales momentum, route delay or manager plan gap.

5. **Safe next step**
   The system recommends one practical action: create a task, alert a manager, add a note, draft a follow-up, flag a route issue or prepare an invoice reminder.

6. **Approval**
   The action is not hidden. The manager sees a preview of what will be created or changed and can approve, reject or edit it.

7. **Execution**
   After approval, the action goes through queued, executing, executed or failed. It is not marked done until the real module write succeeds.

8. **Audit**
   Every recommendation and decision stays traceable: what was detected, what evidence was used, who approved, what executed and what failed.

9. **Playbook learning**
   When the same pattern repeats and managers approve the same kind of action, it can become a controlled playbook. Autopilot is only for safe, tenant-approved workflows.

## Demo Flow

### 1. Open Advisor Center

Show `/ai/actions`.

Narration:

This is the Advisor Center. The first screen is not a chat. It is today's operational queue.

The top area summarizes the business situation: open risks, critical risks, money at risk, pending actions, active modules and failed executions.

### 2. Show Daily Briefing

Point to the daily briefing / summary strip.

Narration:

The goal is that a manager understands the day in a few seconds. What changed, what became critical and where attention is needed now.

### 3. Show Today Risk List

Click a risk in the signal rail.

Narration:

Each row is a real signal. It has a module, severity, owner or team, business metric and one recommended next step.

The important part is that this is not model imagination. The model may explain the signal, but the signal itself comes from CRM data and deterministic rules.

### 4. Show Evidence Panel

Open selected risk details.

Narration:

Here the manager sees why this matters, the facts and source records. If this is finance, we see the invoice or payment. If this is sales, we see the deal or offer. If this is route execution, we see visits, missed stops, last activity or visit evidence.

### 5. Show Source Links

Click or hover source links.

Narration:

Every recommendation must be traceable. A manager can jump from the Advisor to the original CRM object and verify the data.

### 6. Show Recommended Action

Point to the action preview.

Narration:

Advisor does not just say "there is a problem." It prepares the next safe step. For example: create a follow-up task, alert a supervisor, draft a reminder or flag a field issue.

### 7. Queue Action

Click queue action.

Narration:

The action is now queued for approval. This is the trust layer. AI does not silently mutate business data.

### 8. Show Approval Queue

Open Queue tab.

Narration:

Before approval, the manager sees what will happen: target object, payload, risk level and evidence snapshot. The manager can approve, reject or edit safe business fields.

### 9. Show Execution / History

Open History / execution trail.

Narration:

After approval, the action must move through execution states. If it fails, the failure reason stays visible. If it succeeds, the audit trail proves what changed and when.

### 10. Show Modules Health

Open Modules tab.

Narration:

The Advisor also shows coverage by module. This is important because an empty queue can mean two different things: there are no risks, or a module is disabled, has no access, has no data or a collector failed. The system should be honest about this.

### 11. Show Ask

Open Ask tab and ask a scoped question.

Example:

> Where is money at risk today?

Narration:

Ask is not a separate chatbot. It narrows and explains existing signals with sources. It should help investigate the operational queue, not hide work inside a chat transcript.

### 12. Show Record-Level Widget

Open a deal, invoice, ticket, route or MTM record with the Advisor widget.

Narration:

The same Advisor logic appears where work happens. On a record, the widget answers: why is this record at risk and what is the next safe action?

## Closing Narration

The value of this section is not that it says "AI".

The value is that LeadDrive becomes proactive:

- it finds delays before the manager searches for them;
- it connects risks across modules;
- it explains every recommendation with evidence;
- it prepares the next action;
- it keeps human approval and audit in control.

The end goal is a controlled operations advisor for the whole CRM: sales, contracts, marketing, tasks, finance, support, routes, field execution and KPI management.

The correct promise is:

> Da Vinci Advisor helps managers see what needs attention, understand why, and approve the next safe step.

Avoid saying:

> AI automatically runs the business.

Use:

> Advisor recommends. Manager approves. Execution is audited.
