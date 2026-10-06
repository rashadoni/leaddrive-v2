"use client"

// Current compact list, detail panel and draft-first workflow. No video regenerated.
import { HelpScenario, HelpSection, HelpStep, HelpCallout } from "@/components/help/help-content"

export default function EntitlementsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="You are a support manager or administrator" goal="Find a customer’s terms, review risk and prepare a contract for activation">
        Open Support → Support terms. A term links a company to an SLA policy, support level, validity period and milestone rules. The list is scoped to your organization.
      </HelpScenario>
      <HelpCallout kind="tip"><p>For example: create draft support terms for a customer, select an SLA policy, apply a template to copy its milestone rules, review the copy, then activate the terms. Later template edits do not change copied rules. The SLA policy sets response and resolution targets; the terms add their own milestone rules.</p></HelpCallout>
      <HelpSection title="Find the relevant terms">
        <HelpStep n={1}>
          <p>The compact summary shows terms expiring within 30 days, milestones needing attention and active companies without coverage. Select the expiry or attention count to apply its risk filter.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Filter by company, status, support level, SLA policy and risk. On narrow screens, expand the filters first. Reset filters when nothing matches; this is different from having no terms in the organization.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>Wide screens show a table with company, level, SLA, validity, milestone health and status. Narrow screens show compact entries for the same terms. Select a company name or its view action to open details in a side panel.</p>
        </HelpStep>
      </HelpSection>
      <HelpSection title="Read the details">
        <HelpStep n={1}>
          <p>The panel shows the company, level and status, SLA policy, validity, rule count and milestone health. No end date means open-ended terms. Milestone rules and any saved notes appear below.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>The overdue count covers open milestones whose deadlines passed within the last 30 days. An at-risk milestone is open and due within 24 hours. Read the status text as well as the color. Investigate through the customer’s related tickets or SLA settings.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>Close the panel to return to the list. Viewing details does not change a term.</p>
        </HelpStep>
      </HelpSection>
      <HelpSection title="Create a draft and configure rules">
        <HelpStep n={1}>
          <p>With write permission, select “Create support term” to open a separate form panel. Choose a company, SLA policy and support level, then enter the start date. Add an end date and notes when needed. If no company or policy is available, prepare those in their respective sections first.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Select “Create draft”. The term is saved as a draft first. Open “Manage rules” in its details to use an available template or add the required milestones, deadlines and scope. A draft does not establish active coverage.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>After reviewing the rules, use the available activation action and confirm its dialog. Activation requires at least one milestone rule. Your permissions and the current status determine which actions are available.</p>
        </HelpStep>
      </HelpSection>
      <HelpSection title="Changes and recovery">
        <HelpStep n={1}>
          <p>Fields and rules can be edited with write permission while a term is draft or suspended. An active term requires an allowed status transition first; use the actions offered in its panel.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Suspend, resume, expire and cancel depend on status and separate permissions. Read the transition dialog and provide a reason when required. Deleting a rule also requires confirmation.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>If saving fails, address the displayed error and retry. Closing a changed form asks you to confirm discarding unsaved edits. For a load failure, use Retry when available; repeatedly retrying does not resolve an access denial.</p>
        </HelpStep>
      </HelpSection>
      <HelpCallout kind="warning">
        <p>Milestone rules supplement the SLA policy. Creating a draft or reading the summary does not activate coverage or resolve overdue work automatically.</p>
      </HelpCallout>
      <HelpCallout kind="security">
        <p>Read, write, activation and cancellation permissions are checked separately. A read-only view does not offer mutation actions. Work only with your organization’s terms.</p>
      </HelpCallout>
    </div>
  )
}
