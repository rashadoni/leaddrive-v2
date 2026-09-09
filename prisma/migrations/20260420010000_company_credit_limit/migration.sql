-- AlterTable: add credit limit fields to companies
ALTER TABLE "companies" ADD COLUMN "creditLimit" DOUBLE PRECISION;
ALTER TABLE "companies" ADD COLUMN "creditCurrency" TEXT;
