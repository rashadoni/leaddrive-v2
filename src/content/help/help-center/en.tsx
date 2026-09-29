"use client"

import {
  HelpCallout,
  HelpDef,
  HelpKey,
  HelpSection,
  HelpStep,
} from "@/components/help/help-content"

export default function HelpCenterHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Open the guide for your current screen">
        <p>
          Help stays beside your work. It explains the screen you are viewing without taking you
          to a separate help site or changing any CRM data.
        </p>
        <HelpStep n={1}>
          <p>
            Select the orange <HelpKey>?</HelpKey> or <HelpKey>Help</HelpKey> control near the page
            title or toolbar.
          </p>
          <HelpCallout kind="see">
            A guide slides in from the right. Its title and subtitle name the section it explains.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Scroll through the steps, field definitions, tips, and safety notes.</p>
          <HelpCallout kind="see">
            The CRM screen remains behind the guide, so you can close Help and continue where you
            stopped.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If a <HelpKey>Video</HelpKey> button is present, select it for the approved walkthrough
            of that section.
          </p>
          <HelpCallout kind="see">
            No Video button simply means that this section currently has a text guide only.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Move between section Help and this guide">
        <HelpStep n={1}>
          <p>
            In a section guide, select <HelpKey>About Help</HelpKey> to open this general guide.
          </p>
          <HelpCallout kind="see">
            The drawer stays open and replaces only its article; your CRM page does not move.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Select <HelpKey>Back to section guide</HelpKey> to return to the article you started
            from.
          </p>
          <HelpCallout kind="see">
            The original section title and instructions return in the same drawer.
          </HelpCallout>
        </HelpStep>
        <p>
          Help follows your LeadDrive language. Available controls and examples can differ by
          role, enabled module, organization settings, and screen size.
        </p>
      </HelpSection>

      <HelpSection title="Choose the right kind of guidance">
        <dl className="rounded-md border p-3">
          <HelpDef term="Help">Instructions for the screen you are currently using.</HelpDef>
          <HelpDef term="Tour">A short on-screen introduction. Use Replay tour when that control is available.</HelpDef>
          <HelpDef term="Da Vinci">An AI assistant for focused CRM questions, analysis, searches, and supported actions.</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          If the screen does not match the article, first check your role and enabled modules. Then
          ask your administrator which configuration is active for your organization.
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        Opening, reading, or closing Help never edits a record. Only the actions you deliberately
        take on the underlying CRM screen can change data.
      </HelpCallout>
    </div>
  )
}
