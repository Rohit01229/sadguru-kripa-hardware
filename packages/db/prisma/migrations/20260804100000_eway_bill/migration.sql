-- e-Way bill (docs/architecture/20 §7). Applies at ANY turnover for consignments
-- above the state threshold, so unlike e-invoicing every shop needs this. Pure add:
-- a new table + two enums, no change to existing rows.
-- CreateEnum
CREATE TYPE "EwayBillStatus" AS ENUM ('DRAFT', 'GENERATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('ROAD', 'RAIL', 'AIR', 'SHIP');

-- CreateTable
CREATE TABLE "EwayBill" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "EwayBillStatus" NOT NULL DEFAULT 'DRAFT',
    "consignmentValue" INTEGER NOT NULL,
    "fromPincode" TEXT NOT NULL,
    "toPincode" TEXT NOT NULL,
    "fromStateCode" TEXT NOT NULL,
    "toStateCode" TEXT NOT NULL,
    "distanceKm" INTEGER,
    "transportMode" "TransportMode",
    "vehicleNumber" TEXT,
    "overDimensional" BOOLEAN NOT NULL DEFAULT false,
    "transporterGstin" TEXT,
    "transporterName" TEXT,
    "transportDocNo" TEXT,
    "transportDocDate" TIMESTAMP(3),
    "ewbNo" TEXT,
    "ewbDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EwayBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EwayBill_invoiceId_key" ON "EwayBill"("invoiceId");

-- CreateIndex
CREATE INDEX "EwayBill_shopId_idx" ON "EwayBill"("shopId");

-- CreateIndex
CREATE INDEX "EwayBill_shopId_status_idx" ON "EwayBill"("shopId", "status");

-- AddForeignKey
ALTER TABLE "EwayBill" ADD CONSTRAINT "EwayBill_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

