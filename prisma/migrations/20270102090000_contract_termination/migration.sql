-- Termination and cancellation of a contract (owner 2026-11-26, mock «Расторжение»). Until now
-- «Расторгнут» and «Отменён» were reachable by no button. A termination names the first day the
-- contract no longer applies (today or earlier: at once; later: the finance deadline job moves it on
-- that day), a reason code and a comment; a cancellation — a contract that never took effect — its
-- reason in "closeNote". Who recorded either and when: "closedBy", "closedAt".
ALTER TABLE "contracts"
    ADD COLUMN IF NOT EXISTS "terminationDate" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "terminationReason" TEXT,
    ADD COLUMN IF NOT EXISTS "closeNote" TEXT,
    ADD COLUMN IF NOT EXISTS "closedBy" TEXT,
    ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_termination_reason_check') THEN
        ALTER TABLE "contracts"
            ADD CONSTRAINT "contracts_termination_reason_check" CHECK (
                "terminationReason" IS NULL
                OR "terminationReason" IN ('mutual_agreement', 'our_initiative', 'counterparty_initiative', 'breach', 'other')
            );
    END IF;
END $$;

-- The signed termination agreement is a contract file of its own kind, kept like the paper-signed scan.
ALTER TABLE "contract_files" DROP CONSTRAINT IF EXISTS "contract_files_purpose_check";
ALTER TABLE "contract_files"
    ADD CONSTRAINT "contract_files_purpose_check" CHECK ("purpose" IN ('attachment', 'signed_copy', 'termination_copy'));
