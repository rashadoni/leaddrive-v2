"use client"

/**
 * «Approval limits» — who approves an order depending on its amount (English).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementSettingsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="An administrator" goal="Set who approves purchase orders and in what order">
        Only an administrator changes the limits; others see the rules. An order outside every band is approved by a manager.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <dl className="rounded-md border p-3">
          <HelpDef term="Band">the <HelpKey>From</HelpKey> and <HelpKey>Up to (empty — no limit)</HelpKey> amounts; an order falls into a band by its total.</HelpDef>
          <HelpDef term="Approvers in order">each step is a role (Manager, Finance, Purchasing, Administrator) or a named person; steps open one after another.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step">
        <HelpStep n={1}>
          <p>Press <HelpKey>Add band</HelpKey>, enter e.g. 0 — 5000 and pick a person for the first step.</p>
          <HelpCallout kind="see" label="What you'll see">A band card appears: step «1.» shows the person, e.g. «Person: Lalə Quliyeva».</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>For larger amounts <HelpKey>Add band</HelpKey> again: from 5000, «Up to» empty; with <HelpKey>Add approver</HelpKey> — two steps: Manager, then Finance.</p>
          <HelpCallout kind="see" label="What you'll see">The second band shows two steps; the second opens after the first.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Press <HelpKey>Save</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">«Saved»; the new rules apply to the next orders sent for approval.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning">Bands must not overlap — otherwise the limits can't be saved.</HelpCallout>

      <HelpCallout kind="security">The author of an order can't approve it; an administrator can approve any step. Finance can approve but can't do purchasing work.</HelpCallout>
    </div>
  )
}
