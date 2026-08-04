-- First-run onboarding (docs/architecture/16 §6) + the shop phone the bill theme
-- already had a toggle for but no field to render. Pure add, both nullable.
-- AlterTable
ALTER TABLE "StoreConfig" ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT;

