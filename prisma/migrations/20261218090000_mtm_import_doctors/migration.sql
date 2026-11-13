-- Doctors from Excel (Zeytun, 2026-11-13: the client's list of 454 neurologists
-- with their agents and clinics). One more kind of import job; nothing else.
ALTER TYPE "MtmImportType" ADD VALUE IF NOT EXISTS 'DOCTORS';
