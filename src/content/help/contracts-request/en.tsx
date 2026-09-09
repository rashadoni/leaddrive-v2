"use client"

/**
 * Request a Contract — help article (English).
 * Covers only the Contracts → Request a Contract page
 * (/contracts/request): picking and filling an intake form,
 * submitting, the success screen, and the role-gated
 * "Submissions Queue" tab. Contract create/edit and the admin
 * form-builder are NOT in scope.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractsRequestHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an employee who needs a contract (sales, procurement, or operations), or a manager/admin who processes incoming requests"
        goal="Fill in a ready-made request form to create a draft contract and notify the team"
      >
        You reach this page as <HelpKey>Request a Contract</HelpKey>, opened from the{" "}
        <HelpKey>Contracts</HelpKey> list. The back arrow at the top left returns you to the contracts
        list. The form itself is set up in advance by an administrator — you simply pick one of the
        available forms and answer its questions. All forms and submitted requests belong to your
        organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Request a Contract</HelpKey> with a file-input icon, and
          below it the line "Fill in the request form and a draft contract will be created for the team
          to process." For a regular user the page goes straight to the request form. If your role is{" "}
          <strong>superadmin</strong>, <strong>admin</strong>, or <strong>manager</strong>, a tab strip
          appears under the header with two tabs: <HelpKey>Submit Request</HelpKey> and{" "}
          <HelpKey>Submissions Queue</HelpKey>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Request type">A dropdown — you pick one of the active request forms an administrator created; the contract type, if set, appears in parentheses next to the name.</HelpDef>
          <HelpDef term="Question">Each field of the form you selected — it can be text, long text, number, date, or a dropdown choice. Required questions have a red asterisk (*) next to the label.</HelpDef>
          <HelpDef term="Submit request">The button that sends your answers — it creates a draft contract and notifies the team.</HelpDef>
          <HelpDef term="Draft contract">The contract record created automatically from your request; it can be opened directly from the success screen.</HelpDef>
          <HelpDef term="Submissions Queue">Visible only to managers/admins — the list of every request submitted in the organization, each with a status badge.</HelpDef>
        </dl>
        <p>
          If no active form exists, the message "No active request forms are available. Ask an admin to
          configure one." is shown instead of the form. In that case, ask an administrator to set up at
          least one active form.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: submit a request">
        <HelpStep n={1}>
          <p>
            (If you're a manager/admin) make sure the <HelpKey>Submit Request</HelpKey> tab is selected
            in the strip at the top. For a regular user the form is already open directly.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            At the top of the card a dropdown labeled <strong>Request type</strong> appears, showing
            "Choose a request type...".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a form from the <strong>Request type</strong> dropdown (for example one named after the
            relevant contract type).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A short description of the form appears below it (if one is set), followed by the form's
            questions one by one. Each question renders the input that matches its type: a plain text
            box, a multi-line box, a number-only box, a date picker, or a dropdown starting with
            "Choose...".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Fill in the questions. Fields with a red <strong>*</strong> next to the label are required;
            for a dropdown question, pick one of the options.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Your answers appear in the matching fields as you type. A number question only accepts
            digits, and a date question accepts the date picker.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click the full-width <HelpKey>Submit request</HelpKey> button at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner appears on the button and it is briefly disabled. On success the page switches to
            the success screen with a green check mark; on failure a red bar "Failed to submit request.
            Please check your answers and try again." appears at the top and the form stays open.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: what happens after submitting">
        <HelpStep n={1}>
          <p>
            After the request is submitted successfully, look at the success screen.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A green check circle in the center, with the heading "Request submitted!" and the text "A
            draft contract has been created and the team has been notified." If the request was routed
            for approval automatically, an extra line states how many stages it was sent to.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Choose one of the two buttons: <HelpKey>All contracts</HelpKey> returns you to the list, and{" "}
            <HelpKey>View draft contract</HelpKey> opens the newly created draft.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>View draft contract</HelpKey> takes you to that contract's page;{" "}
            <HelpKey>All contracts</HelpKey> opens the contracts list.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: check the submissions queue (manager/admin)">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Submissions Queue</HelpKey> tab (inbox icon) in the strip at the top.
            This tab is visible only to superadmin, admin, and manager roles.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Instead of the form, a card list of submitted requests loads (the most recent 50). If there
            are no submissions yet, "No submissions yet." is shown; if loading fails, a red error bar
            appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read each card: it shows the form name (with the contract type in parentheses if set), the
            submission date and time, and who submitted it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A status badge sits on the right of the card — <strong>pending</strong>,{" "}
            <strong>processing</strong>, <strong>completed</strong>, or <strong>rejected</strong>. The
            badge color changes with the status.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If a contract is linked, jump to it with the button on the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When a contract has been created, the card has a button showing its number (or "View draft
            contract" if it has no number); clicking it opens that contract's page.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The point of a request is that instead of building a contract from scratch you fill in a
          ready-made form — the system does the rest automatically: it creates the draft contract,
          notifies the team, and, if the form is set up that way, routes it into approval stages. If you
          can't find the right form, ask an administrator to add one that fits your case.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Submit request</HelpKey> only appears after you select a <strong>Request type</strong>{" "}
          — the questions and the submit button don't show until a form is chosen. If submitting fails,
          check that the required (*) fields are filled and the answers are valid, then try again; the
          form and what you typed are not lost.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All request forms and submitted requests are scoped to your organization — you don't see
          another tenant's forms or submissions. The <HelpKey>Submissions Queue</HelpKey> tab is open
          only to the superadmin, admin, and manager roles; a regular user only sees the form and
          submits their own request.
        </p>
      </HelpCallout>
    </div>
  )
}
