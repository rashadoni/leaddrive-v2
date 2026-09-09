"use client"

/**
 * Products & Services — help article (English).
 *
 * Covers the /products catalog: the reusable list of things you sell
 * (services, products, add-ons, consulting) with price, currency,
 * features, tags, and an active flag — plus the per-product detail page
 * and the inventory delete-guard.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProductsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          <strong>Products &amp; Services</strong> is your catalog — the reusable list of everything
          you sell. Define each offering once with a price and a category, and it becomes a building
          block you can reuse instead of re-typing the same thing on every record.
        </p>
        <p>
          A catalog entry can be a one-off <em>product</em>, an ongoing <em>service</em>, an{" "}
          <em>add-on</em>, or a <em>consulting</em> engagement. Keep it tidy here and your pricing
          stays consistent everywhere.
        </p>
      </HelpSection>

      <HelpSection title="What a catalog entry holds">
        <p>
          Each product carries a name, a category, a price in a chosen currency, an active flag, and
          two free-form lists — features and tags.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Name">Required — the product or service name.</HelpDef>
          <HelpDef term="Category">Service, Product, Add-on, or Consulting.</HelpDef>
          <HelpDef term="Price">A number plus a currency; <strong>0</strong> renders as <em>Free</em>.</HelpDef>
          <HelpDef term="Features">A comma-separated list (e.g. <em>Azure/AWS, Zero Downtime</em>).</HelpDef>
          <HelpDef term="Tags">A comma-separated list for grouping and search.</HelpDef>
          <HelpDef term="Status">Active or Inactive — a simple availability flag.</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            <strong>Features</strong> and <strong>tags</strong> are both typed as plain
            comma-separated text — &quot;Data Migration, Support&quot; becomes two separate chips.
            Spaces around the commas are trimmed and empty entries are dropped, so you don&apos;t
            have to be precise.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Add or edit a product">
        <HelpStep n={1}>
          <p>
            Press <HelpKey>New Product</HelpKey>. Fill in the name (required), an optional
            description, pick a category, and set a price with its currency.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Add features and tags as comma-separated text, and leave <HelpKey>Active</HelpKey> on if
            the product is available for sale. Save with <HelpKey>Create Product</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To change an entry later, click the <HelpKey>pencil</HelpKey> on its row (or open the
            product and press <HelpKey>Edit</HelpKey>), adjust the fields, and{" "}
            <HelpKey>Save Changes</HelpKey>.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            The currency menu offers a fixed set of codes (AZN, USD, EUR, GBP, RUB, PLN, and more).
            Price and currency are stored per product — there is no automatic conversion between
            currencies, so set each entry in the currency you actually charge.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="The catalog list">
        <p>
          The top of the page shows four counters: <strong>Total Products</strong>,{" "}
          <strong>Active</strong>, <strong>Total Value</strong> (the sum of every product&apos;s
          price), and <strong>Categories</strong> (how many distinct categories you use).
        </p>
        <HelpStep n={1}>
          <p>
            Filter by the category pills (<HelpKey>All</HelpKey>, Service, Product, Add-on,
            Consulting). A category pill only appears once at least one product uses it, and each
            shows its count.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Search by name in the table&apos;s search box. The <strong>Price</strong> column shows
            the amount with its currency, or <em>Free</em> when the price is 0.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            The <strong>Features</strong> column shows the first three feature chips and a{" "}
            <em>+N</em> badge for the rest. Click any row to open that product&apos;s detail page.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="The product detail page">
        <p>
          Opening a product shows KPI cards for its price, category, feature count, and tag count,
          plus two tabs:
        </p>
        <HelpStep n={1}>
          <p>
            <strong>Details</strong> — the name, category, price, status, description, and tags.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Features</strong> — each feature laid out as its own checklist row (or an empty
            state when there are none).
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Press <HelpKey>Edit</HelpKey> to edit in place, then <HelpKey>Save</HelpKey> — or{" "}
            <HelpKey>Cancel</HelpKey> to discard. <HelpKey>Delete</HelpKey> removes the product.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          The whole catalog is scoped to your organization — you only ever see and edit your own
          tenant&apos;s products. Deleting is blocked when a product still has inventory stock: the
          app keeps it and shows{" "}
          <em>&quot;Cannot delete a product that still has inventory stock&quot;</em> so a referenced
          item can&apos;t silently disappear. Remove or reassign that inventory first, then delete.
        </p>
      </HelpCallout>
    </div>
  )
}
