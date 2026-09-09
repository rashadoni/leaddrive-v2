"use client"

/**
 * Invoice Settings — help article (English).
 * Covers only Settings → Invoice Settings: company information, invoice
 * defaults (number prefix / payment terms / tax rate / currency), bank
 * details, signer + stamp + act signer, default text, and the three-language
 * email templates. Creating or sending an invoice is NOT covered — this is the
 * settings page only.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function invoicesettingsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a finance or operations administrator"
        goal="Set up — once — the company details, bank details, signature/stamp and email templates that flow automatically onto every invoice"
      >
        Reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Invoice Settings</HelpKey>.
        Everything you enter here belongs only to your organization and is applied as a{" "}
        <strong>default</strong> to newly created invoices — you can still override it per invoice.
        Nothing saves automatically: you must confirm changes with the <HelpKey>Save</HelpKey> button
        at the top right.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a gear icon with the title <HelpKey>Invoice Settings</HelpKey>, the
          description «Invoice defaults, branding &amp; bank details» and a hint line below it. The{" "}
          <HelpKey>Save</HelpKey> button sits at the top right; the save result (a green «Saved
          successfully» or a red error) appears next to it. Below come six cards in order:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Company Information">Company details shown on invoices: name, address, VÖEN (tax ID), email, phone and logo URL. May differ from your organization name.</HelpDef>
          <HelpDef term="Default Settings">Defaults applied to new invoices: number prefix, payment terms, tax rate and currency. Can be overridden per invoice.</HelpDef>
          <HelpDef term="Bank Details">Bank information shown on the invoice: bank name, code (MFO), SWIFT, account number, VÖEN and correspondent account.</HelpDef>
          <HelpDef term="Signer & Stamp">The name/title of the person who signs the invoice, a scan of the company stamp, plus a separate act (Handover Act) signer with name, title and signature scan.</HelpDef>
          <HelpDef term="Default Text">Standard terms &amp; conditions and footer note text included on every invoice.</HelpDef>
          <HelpDef term="Email Templates">The email text used when an invoice is sent — a separate template per language (AZ / Russian / English): Greeting, Body, Closing and Footer note.</HelpDef>
        </dl>
        <p>
          On first open the page shows a collapsed grey placeholder (a skeleton) — this is your
          existing settings loading; after a moment the fields fill with previously saved values.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: fill in company information">
        <HelpStep n={1}>
          <p>
            In the first card — <HelpKey>Company Information</HelpKey> — fill in{" "}
            <strong>Company Name</strong> and <strong>Company Address</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each field carries an example (placeholder) — e.g. «Your Company LLC» in the name field
            and «123 Main St, Baku, Azerbaijan» in the address. As you type the placeholder
            disappears and your text shows. Address is a multi-line field.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fill in the paired fields below: <strong>VÖEN</strong> and <strong>E-poçt (Email)</strong>,
            then <strong>Telefon (Phone)</strong> and <strong>Logo URL</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The fields are laid out in two columns. The email field expects an email format. Below
            Logo URL the note «Optional — displayed on invoice header» means it is not required and
            appears in the invoice header.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set invoice defaults">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Default Settings</HelpKey> card type an invoice-number prefix into{" "}
            <strong>Number Prefix</strong> (e.g. <HelpKey>INV-</HelpKey> or <HelpKey>KP-</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The hint «Prefix for invoice numbers, e.g. INV-001, KP-001» appears under the field — the
            prefix is added before the number.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a payment term from the <strong>Default Payment Terms</strong> dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown offers ready options: <strong>Due on Receipt</strong>, <strong>Net 15</strong>,{" "}
            <strong>Net 30</strong>, <strong>Net 45</strong> and <strong>Net 60</strong> (number of
            days). Net 30 is the default.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Type the tax rate as a percentage into <strong>Default Tax Rate</strong> and pick a
            currency from the <strong>Default Currency</strong> dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The tax field accepts numbers only, has a <strong>%</strong> sign on the right and the note
            «Standard VAT rate in Azerbaijan is 18%» below it. Each row of the currency list shows the
            currency code and symbol (e.g. AZN ₼).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: fill in bank details">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Bank Details</HelpKey> card fill in the paired fields:{" "}
            <strong>Bank adı (Bank name)</strong> and <strong>Kod (MFO)</strong>, then{" "}
            <strong>SWIFT</strong> and <strong>Hesab nömrəsi (Account number)</strong>, finally{" "}
            <strong>VÖEN</strong> and <strong>Müxbir hesab (Correspondent account)</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each field carries an example value — e.g. «Example Bank OJSC» for the bank name and an
            IBAN-style «AZ00AIIB00000000000000000000» for the account number. This information appears
            on the sent invoice.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set the signer, stamp and act signer">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Signer &amp; Stamp</HelpKey> card fill in the{" "}
            <strong>Ad Soyad (Full name)</strong> and <strong>Vəzifə (Title)</strong> of the person
            who signs the invoice.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Two-column fields; examples «Yusif Rzayev» and «Director of LeadDrive Inc.» are shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In <strong>Şirkət Möhürü / Company Stamp (scan)</strong> click the dashed upload strip and
            choose the stamp image (PNG, JPG — max 2MB).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If no stamp exists yet, an upload strip with an up-arrow icon reading «Möhür şəklini
            yükləyin» appears. After selecting an image its white background is removed automatically,
            a small preview shows on the left, and on the right a green «✓ Möhür yüklənib» (stamp
            uploaded) message with a <HelpKey>Dəyişdir / Replace</HelpKey> button appears; the × in the
            preview corner removes the image.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the <strong>Act signer (Handover Act)</strong> section lower in the same card, fill in
            the <strong>Full name</strong> and <strong>Title</strong> of whoever signs the act and
            upload the <strong>İmza / Signature (scan)</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            This section sits after a divider line. When the signature is uploaded you get a preview, a
            green «✓ İmza yüklənib» (signature uploaded) message and a <HelpKey>Replace</HelpKey>{" "}
            button; this signature is separate from the stamp and is added only to the act document.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            When stamp and signature images are uploaded the white/light background is cut out and made
            transparent automatically, so even a scan on plain white paper works well. For the cleanest
            result use a transparent-background PNG.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: default text and email templates">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Default Text</HelpKey> card fill in the{" "}
            <strong>Default Terms &amp; Conditions</strong> and <strong>Default Footer Note</strong>{" "}
            multi-line fields.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Both fields are multi-line and come with example text («Payment is due within the specified
            terms…» and «Thank you for your business!»). This text is included on every invoice.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            At the top of the <HelpKey>Email Templates</HelpKey> card pick one of the language tabs:{" "}
            <HelpKey>Azerbaijani</HelpKey>, <HelpKey>Russian</HelpKey> or <HelpKey>English</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected tab is underlined in cyan. The fields below — <strong>Greeting</strong>,{" "}
            <strong>Body text</strong>, <strong>Closing</strong>, <strong>Footer note</strong> — show
            only the text for that language; switching tabs shows that language's text.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            For the chosen language fill in <strong>Greeting</strong>, <strong>Body text</strong>,{" "}
            <strong>Closing</strong> and <strong>Footer note</strong>. You can use variables in the
            text.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A grey box at the bottom of the card lists the available variables:{" "}
            <HelpKey>{"{orgName}"}</HelpKey> — company name, <HelpKey>{"{invoiceNumber}"}</HelpKey> —
            invoice number, <HelpKey>{"{total}"}</HelpKey> — total amount,{" "}
            <HelpKey>{"{currency}"}</HelpKey> — currency, <HelpKey>{"{dueDate}"}</HelpKey> — due date.
            On send these variables are replaced with the real values.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If you want all three language templates, switch tabs in turn and fill them in — text you
            entered is not lost when you switch tabs; everything is saved together.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When you switch from one language to another, what you typed in the previous language is
            preserved; it reappears when you return.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: save your changes">
        <HelpStep n={1}>
          <p>
            After filling in all the cards, click the <HelpKey>Save</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While saving the button shows a spinning icon and is briefly disabled. On success a green
            checkmark with <strong>Saved successfully</strong> appears next to the button; on error a
            red icon with <strong>Failed to save</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          Changes on this page are <strong>not saved automatically</strong>. If you edit any field but
          leave the page without clicking <HelpKey>Save</HelpKey>, the changes are lost. Leave only
          after you see the green «Saved successfully» message.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All invoice settings are scoped to your organization — the values you set here apply only to
          your tenant's invoices and are not visible to other organizations. On save, the settings are
          updated only under your organization identity.
        </p>
      </HelpCallout>
    </div>
  )
}
