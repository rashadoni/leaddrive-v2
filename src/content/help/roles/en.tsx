"use client"

/**
 * Roles & Permissions — help article (English).
 * Settings → Roles & Permissions is a read-only reference of what each
 * built-in role can do; module access for one person is set in the user's card
 * (Settings → Users → "Module access"), and this article says so.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function RolesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are an organization administrator"
        goal="See what each role can do and limit which modules a particular employee gets"
      >
        Reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>Roles &amp; Permissions</HelpKey>. It is a reference: nothing is edited here.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is a card with the <HelpKey>Open Users</HelpKey> button: module access is not set here but in the employee&apos;s card. Below are the built-in roles with their user counts and the “What each role can do” table: modules down the side, roles across the top, the access level where they meet.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Full">create, change and delete the module&apos;s records.</HelpDef>
          <HelpDef term="Edit">create and change, no deleting.</HelpDef>
          <HelpDef term="View">read only.</HelpDef>
          <HelpDef term="None">the module is not available to this role.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: hide a module from an employee">
        <HelpStep n={1}>Click <HelpKey>Open Users</HelpKey> and open the employee (or create a new one).</HelpStep>
        <HelpStep n={2}>Under <HelpKey>Module access</HelpKey>, untick the modules they do not need.</HelpStep>
        <HelpStep n={3}>Save. The module disappears from their menu on their next click; they do not need to sign in again.</HelpStep>
        <HelpCallout kind="warning">
          The roles table shows the rights the system actually enforces. They cannot be changed on this page, and a custom role cannot be created: an employee is given one of the built-in roles.
        </HelpCallout>
        <HelpCallout kind="tip">
          An administrator always sees every module the organization has — a module cannot be hidden from an administrator.
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
