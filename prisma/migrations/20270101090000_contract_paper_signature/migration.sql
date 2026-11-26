-- A contract signed on paper becomes «Действующий» the way an e-signed one does (owner 2026-11-26,
-- mock «Подписан на бумаге»): a person records the signing date and uploads the scan. The scan is a
-- contract file marked "signed_copy" — the evidence behind the status — and is kept out of the
-- ordinary delete. Every other file stays an "attachment", which is also what all existing rows are.
ALTER TABLE "contract_files"
    ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'attachment';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contract_files_purpose_check'
    ) THEN
        ALTER TABLE "contract_files"
            ADD CONSTRAINT "contract_files_purpose_check" CHECK ("purpose" IN ('attachment', 'signed_copy'));
    END IF;
END $$;
