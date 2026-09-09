-- Free-text buyer name for the quote PDF "FOR" line (overrides the linked deal's company).
ALTER TABLE "quotes" ADD COLUMN "customerName" TEXT;
