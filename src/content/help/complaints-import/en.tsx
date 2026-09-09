"use client"

/**
 * Import complaints register (xlsx) — help article (English).
 * Covers only the Complaints → Import page: upload an xlsx, read the
 * preview (dry-run), import the records into the registry. The registry
 * itself (the complaint list / detail) is NOT in scope here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function complaintsimportHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a quality/customer-care operator or an administrator"
        goal="Bulk-migrate the client's existing Excel complaints register into the system"
      >
        You reach this page from the <HelpKey>Complaints</HelpKey> registry via <HelpKey>Import</HelpKey>{" "}
        (or directly at <HelpKey>/complaints/import</HelpKey>). Import accepts only the client's original
        Excel format — an 18-column register in Azerbaijani (Sıra, Müştəri, Tarix, Mənbə, Marka, Məhsul,
        Obyekt, Cavab, Status, Risk…). Each row becomes one <strong>complaint (ticket)</strong> in the
        system. Everything you import is written only to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a <HelpKey>Back to registry</HelpKey> link, then the heading{" "}
          <strong>"Import complaints register (xlsx)"</strong> and a short description. In the center is a
          large <strong>drag-and-drop</strong> zone: a spreadsheet icon, the text "Drop xlsx file here"
          and "or select manually", plus a <HelpKey>Select file</HelpKey> button. Once a file is chosen,
          its name appears below the zone.
        </p>
        <p>
          After you upload a file the page walks through three states in order: first a{" "}
          <strong>"Processing…"</strong> message, then the <strong>Preview</strong> card (a table of the
          recognized rows plus the import button), and after importing the <strong>result card</strong>{" "}
          (how many records were created).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="xlsx / xlsm">Only Excel workbook files are accepted (no CSV, PDF, or other formats).</HelpDef>
          <HelpDef term="Preview (dry-run)">An automatic trial read the moment a file is uploaded: nothing is saved, it just shows how many rows were recognized and how the first 10 rows were parsed.</HelpDef>
          <HelpDef term="Parsed: N rows">The number of readable rows that have complaint content (text); empty rows are not counted.</HelpDef>
          <HelpDef term="Warnings">A list of rows that could not be read (row number + reason); the first 5 are shown.</HelpDef>
          <HelpDef term="historicalNumber">The original register number from the Excel "Sıra" column — preserved on the record so the old numbering isn't lost.</HelpDef>
        </dl>
        <p>
          The preview table columns are fixed: <strong>№</strong> (the file's row number),{" "}
          <strong>Sıra</strong>, <strong>Customer</strong>, <strong>Date</strong>, <strong>Brand</strong>,{" "}
          <strong>Risk</strong> and <strong>Status</strong>. If a value couldn't be read, the cell shows "—".
        </p>
      </HelpSection>

      <HelpSection title="Step by step: upload the file and read the preview">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Select file</HelpKey> and pick the xlsx from your computer — or drag the file
            straight onto the drag-and-drop zone and drop it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When you hover the file over the zone its border lights up. As soon as you drop it the chosen
            file's name appears below the zone and a brief <strong>"Processing…"</strong> message shows.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            You don't need to press any extra button — the system reads the file immediately in{" "}
            <strong>trial mode (dry-run)</strong>. Nothing is saved at this stage.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Preview</strong> card opens. Under the title it reads <strong>"Parsed: N rows"</strong>,
            and if there are errors, <strong>"· errors: M"</strong> next to it. On the right is the{" "}
            <HelpKey>Import N records</HelpKey> button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Check in the table how the first 10 rows were parsed — make sure names, dates, brand and risk
            landed in the right columns.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A table with the columns <strong>№, Sıra, Customer, Date, Brand, Risk, Status</strong>. If
            there are more than 10 rows, below the table you'll see{" "}
            <strong>"+ X more records (showing first 10)"</strong>. Unreadable rows are listed in the{" "}
            <strong>Warnings</strong> section in red, in the "Row R: reason" format.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: import the records">
        <HelpStep n={1}>
          <p>
            If the preview looks right, click the <HelpKey>Import N records</HelpKey> button in the top
            right (where N is the number of recognized rows).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A short <strong>"Processing…"</strong> message appears again. This time the system actually
            creates one complaint (and a linked contact, if applicable) from each row.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Wait for the import to finish.</p>
          <HelpCallout kind="see" label="What you'll see">
            The preview card is replaced by the <strong>result card</strong>. On success you get a green ✓
            icon (or a red ✕ if no record was created), with <strong>"Import completed"</strong> and the
            summary <strong>"Records created: X of Y"</strong> next to it ("· errors: M" is appended if
            there were any).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            After the result you have two choices: <HelpKey>Open registry</HelpKey> takes you to the
            complaint list, while <HelpKey>Import more</HelpKey> resets the page so you can upload another
            file.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking <HelpKey>Import more</HelpKey> clears the result and preview, clears the file name,
            and returns you to the empty drag-and-drop zone.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Before importing, always compare the <strong>"Parsed: N rows"</strong> count in the preview
          against the number of rows in your file. If the number is lower than expected, either the column
          headers weren't recognized or some rows have empty complaint text — those rows are skipped.
          Numbers from the "Sıra" column are preserved as the original register number (historicalNumber).
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          A single file accepts a <strong>maximum of 5000 rows</strong>; anything larger is rejected. If
          the column headers can't be recognized (the "complaint content" column isn't found) the system
          returns an error and imports nothing. The import action itself has <strong>no undo button</strong>{" "}
          — re-uploading the same file may create the records again, so verify with the preview first.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Import runs strictly within your organization (tenant) — every created complaint, contact and
          register metadata is bound to your org and never touches another organization's data. Each
          successful import is written to the audit log (how many complaints, from which file).
        </p>
      </HelpCallout>
    </div>
  )
}
