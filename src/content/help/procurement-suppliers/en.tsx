"use client"

/**
 * «Suppliers» — the companies you buy from (English).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementSuppliersHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="A purchasing officer" goal="Keep suppliers in one place and link them to products">
        A supplier is a company too, with contacts, files and history, but it stays out of the client lists. Adding and importing is purchasing work.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <dl className="rounded-md border p-3">
          <HelpDef term="List">name (with the director below), VÖEN, phone, e-mail and city.</HelpDef>
          <HelpDef term="Search">«Search by name, VÖEN, phone or e-mail».</HelpDef>
          <HelpDef term="Filters"><HelpKey>Active</HelpKey>, <HelpKey>Inactive</HelpKey>, <HelpKey>All</HelpKey>.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: add a supplier">
        <HelpStep n={1}>
          <p>Press <HelpKey>Add supplier</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">A window: name, VÖEN, director, phone, e-mail, website, city, address and notes.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Fill in at least the name, put the payment terms in the notes and press <HelpKey>Save</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">The supplier appears in the list; its e-mail is later used to send the order PDF.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: import from Excel">
        <HelpStep n={1}>
          <p>Press <HelpKey>Import from Excel</HelpKey> and pick an .xlsx or .csv file with <HelpKey>Choose file</HelpKey> (column names in the first row).</p>
          <HelpCallout kind="see" label="What you'll see">The columns are recognised — «Ad / Name», «VÖEN», «Phone», «E-mail» — and you see which column goes to which field; change it if needed.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Press <HelpKey>Check</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">You see how many suppliers will be added, duplicates and rows with errors — nothing is written yet.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Press <HelpKey>Import</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">The new suppliers are added; existing ones (same VÖEN or name) are skipped.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Supplier and product">
        <p>In the «Purchase» block of a product card you choose the default supplier — with the purchase price and lead time. When the product is added to a deal, its purchase price becomes the line's planned cost.</p>
      </HelpSection>

      <HelpCallout kind="tip">Don't delete a supplier you no longer work with — make it inactive: old orders and reports stay linked to it.</HelpCallout>

      <HelpCallout kind="security">Purchase prices and the default supplier are seen only by management, finance and purchasing.</HelpCallout>
    </div>
  )
}
