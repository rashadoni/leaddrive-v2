"use client"

/**
 * Product detail — help article (English).
 * Covers a single product/service record: the /products/[id] page.
 * Main workflow = open a product, review it, edit (details + features)
 * and delete it. The catalog list page is NOT included here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProductdetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales-operations or catalog administrator"
        goal="Open a single product or service record to review its details, edit it, and delete it when needed"
      >
        You reach this page by clicking any row in the <HelpKey>Products &amp; Services</HelpKey> catalog.
        The card shows one product and belongs only to your organization. Everything you see here — price,
        category, features, tags — is read from the same record, so as you edit and save, the cards at the
        top update immediately.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a back arrow, an amber box (package) icon, then the product's{" "}
          <strong>name</strong>. Below the name sit two badges: the <strong>category</strong> (color-coded —
          Service blue, Product green, Add-on purple, Consulting amber) and the <strong>Active</strong> /{" "}
          <strong>Inactive</strong> state. Top-right are the <HelpKey>Edit</HelpKey> and red{" "}
          <HelpKey>Delete</HelpKey> buttons.
        </p>
        <p>
          Beneath that, four stat cards line up: <strong>Price</strong>, <strong>Category</strong>,{" "}
          <strong>Features</strong> (count) and <strong>Tags</strong> (count). Lower down is a two-tab area:{" "}
          <HelpKey>Details</HelpKey> and <HelpKey>Features</HelpKey> (with a count beside it).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Price">The unit price and currency. When the price is 0, it shows as "Free".</HelpDef>
          <HelpDef term="Category">Type: Service, Product, Add-on, or Consulting — shown as a color-coded badge in the header.</HelpDef>
          <HelpDef term="Features">A comma-separated list of the product's capabilities; shown as a count on the card and as individual green-checked rows in the Features tab.</HelpDef>
          <HelpDef term="Tags">Free-form labels for search and grouping; rendered as badges in the Description card.</HelpDef>
          <HelpDef term="SKU / Part #">The product's stock/part code (optional). Only appears in Details when it has been filled in.</HelpDef>
          <HelpDef term="Type">Line type — hardware, license, subscription, service, or other; it drives the quantity rule in quotes (CPQ).</HelpDef>
          <HelpDef term="Active">Whether the product is currently available; an inactive product counts as dormant in the catalog.</HelpDef>
        </dl>
        <p>
          In view mode the <HelpKey>Details</HelpKey> tab has two cards: on the left, an{" "}
          <strong>Edit Product</strong> card listing Name, Category, Price, Status, (if set) SKU and Type;
          on the right, a <strong>Description</strong> card with the description and any tags. The{" "}
          <HelpKey>Features</HelpKey> tab lays each feature out as a card with a green ✓ icon — if there are
          no features, it shows "No data available".
        </p>
      </HelpSection>

      <HelpSection title="Step by step: edit the product">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Edit</HelpKey> at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The top-right buttons switch to <HelpKey>Cancel</HelpKey> and <HelpKey>Save</HelpKey>. The view
            cards on the <HelpKey>Details</HelpKey> tab turn into an edit form.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On the <HelpKey>Details</HelpKey> tab, change the fields: <strong>Name *</strong> (required),{" "}
            <strong>Description</strong>, <strong>Category</strong> (dropdown), <strong>Price</strong> and
            the <strong>currency</strong> selector beside it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Name field is marked with a <strong>*</strong>. Price accepts numbers only; the currency
            dropdown lists currency codes with their symbols (e.g. USD $). The Category list offers Service,
            Product, Add-on, and Consulting.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally fill in <strong>SKU / Part #</strong> (e.g. <HelpKey>HW-1001</HelpKey>),{" "}
            <strong>Type</strong> (hardware, license, subscription, service, other) and{" "}
            <strong>Tags</strong> (comma-separated — e.g. cloud, migration, enterprise).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The SKU and Tags fields show grey placeholder examples. The Type dropdown options appear
            capitalized (Hardware, License…).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Toggle the <HelpKey>Active</HelpKey> checkbox to set availability, then click{" "}
            <HelpKey>Save</HelpKey> at the top. (Changed your mind? <HelpKey>Cancel</HelpKey> reverts every
            field to its previous values.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While saving, the <HelpKey>Save</HelpKey> button shows a spinner, then the form returns to view
            mode. The header name, the category/active badges, and the stat cards at the top all reflect the
            new values.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit the features">
        <HelpStep n={1}>
          <p>
            While in <HelpKey>Edit</HelpKey> mode, switch to the <HelpKey>Features</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The tab label shows the current feature count in parentheses. Inside the tab a single large
            multi-line text box (textarea) opens.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type the features <strong>comma-separated</strong> in the one field (e.g.{" "}
            <HelpKey>Azure/AWS, Zero Downtime, Data Migration</HelpKey>), then confirm with{" "}
            <HelpKey>Save</HelpKey> at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After saving, view mode lays each feature out as its own card with a green ✓ circle. The{" "}
            <strong>Features</strong> stat card count and the number in the tab label update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: delete the product">
        <HelpStep n={1}>
          <p>
            In view mode, click the red <HelpKey>Delete</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog opens showing the product name and warning that deletion can't be undone.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the confirm button in the dialog to finish the delete (or <HelpKey>Cancel</HelpKey> to
            back out).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On success you're taken back to the <HelpKey>Products &amp; Services</HelpKey> list. If the
            product still has inventory stock it won't delete — instead a notice appears: "Cannot delete a
            product that still has inventory stock. Remove or reassign its inventory first."
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Leave the price blank or 0 and the product shows as "Free" both in the header value and the{" "}
          <strong>Price</strong> card — handy for free add-ons or demo bundles.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          A product with inventory stock can't be deleted — the system refuses with a 409. If you want it
          out of the catalog, instead of deleting, use <HelpKey>Edit</HelpKey> → uncheck the{" "}
          <HelpKey>Active</HelpKey> box to make it inactive: the record and its stock stay, it just counts
          as dormant in the catalog.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Every product record is scoped to your organization — you only see and edit your own tenant's
          products. All changes (price, status, features) affect only your organization's catalog.
        </p>
      </HelpCallout>
    </div>
  )
}
