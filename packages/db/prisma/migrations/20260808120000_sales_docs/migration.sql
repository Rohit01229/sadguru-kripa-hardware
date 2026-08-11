-- CreateEnum
CREATE TYPE "SalesDocKind" AS ENUM ('QUOTATION', 'PROFORMA', 'DELIVERY_CHALLAN');

-- CreateEnum
CREATE TYPE "SalesDocStatus" AS ENUM ('OPEN', 'CONVERTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SalesDocCounter" (
    "shopId" TEXT NOT NULL,
    "kind" "SalesDocKind" NOT NULL,
    "fy" TEXT NOT NULL,
    "lastNo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesDocCounter_pkey" PRIMARY KEY ("shopId","kind","fy")
);

-- CreateTable
CREATE TABLE "SalesDoc" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" "SalesDocKind" NOT NULL,
    "fy" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "customerId" TEXT,
    "customerNameSnap" TEXT,
    "customerGstinSnap" TEXT,
    "customerPhoneSnap" TEXT,
    "placeOfSupplyState" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "taxableTotal" DECIMAL(14,2) NOT NULL,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "status" "SalesDocStatus" NOT NULL DEFAULT 'OPEN',
    "cancelledReason" TEXT,
    "convertedInvoiceId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDocLine" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "salesDocId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "saleUnitId" TEXT NOT NULL,
    "hsnCode" TEXT,
    "saleQty" DECIMAL(14,3) NOT NULL,
    "baseQty" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxableValue" DECIMAL(14,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesDocLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesDoc_convertedInvoiceId_key" ON "SalesDoc"("convertedInvoiceId");

-- CreateIndex
CREATE INDEX "SalesDoc_shopId_kind_status_idx" ON "SalesDoc"("shopId", "kind", "status");

-- CreateIndex
CREATE INDEX "SalesDoc_shopId_date_idx" ON "SalesDoc"("shopId", "date");

-- CreateIndex
CREATE INDEX "SalesDoc_customerId_idx" ON "SalesDoc"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDoc_shopId_kind_fy_docNo_key" ON "SalesDoc"("shopId", "kind", "fy", "docNo");

-- CreateIndex
CREATE INDEX "SalesDocLine_salesDocId_idx" ON "SalesDocLine"("salesDocId");

-- CreateIndex
CREATE INDEX "SalesDocLine_shopId_idx" ON "SalesDocLine"("shopId");

-- AddForeignKey
ALTER TABLE "SalesDoc" ADD CONSTRAINT "SalesDoc_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocLine" ADD CONSTRAINT "SalesDocLine_salesDocId_fkey" FOREIGN KEY ("salesDocId") REFERENCES "SalesDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocLine" ADD CONSTRAINT "SalesDocLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

